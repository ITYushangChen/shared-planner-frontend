-- =============================================================================
-- P3a–P3c：长任务分段、指派/冲突通知、冲突协商
-- =============================================================================

-- 长任务父子关系：子任务可独立排期与拖拽
ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS parent_todo_id UUID REFERENCES public.todos(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_todos_parent ON public.todos(parent_todo_id)
  WHERE parent_todo_id IS NOT NULL;

COMMENT ON COLUMN public.todos.parent_todo_id IS '父待办；子任务=长项目分段，可独立移动';

-- 冲突协商状态
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'conflict_resolution_status') THEN
    CREATE TYPE public.conflict_resolution_status AS ENUM (
      'pending',
      'self_resolved',
      'escalated',
      'dismissed'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.conflict_resolutions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id              UUID NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  todo_id               UUID NOT NULL REFERENCES public.todos(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  creator_id            UUID NOT NULL REFERENCES public.profiles(id),
  conflicting_todo_ids  UUID[] NOT NULL DEFAULT '{}',
  status                public.conflict_resolution_status NOT NULL DEFAULT 'pending',
  note                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_conflict_res_user_status
  ON public.conflict_resolutions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_conflict_res_creator_status
  ON public.conflict_resolutions(creator_id, status);
CREATE INDEX IF NOT EXISTS idx_conflict_res_todo
  ON public.conflict_resolutions(todo_id);

COMMENT ON TABLE public.conflict_resolutions IS
  '冲突协商：被指派人可自己解决或打回创建人';

ALTER TABLE public.conflict_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conflict_res_select" ON public.conflict_resolutions;
CREATE POLICY "conflict_res_select"
  ON public.conflict_resolutions FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR creator_id = auth.uid()
    OR public.is_space_member(space_id)
  );

DROP POLICY IF EXISTS "conflict_res_update" ON public.conflict_resolutions;
CREATE POLICY "conflict_res_update"
  ON public.conflict_resolutions FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR creator_id = auth.uid());

-- 指派/改期后：通知被指派人，并检测冲突写入协商单
CREATE OR REPLACE FUNCTION public.notify_todo_assignment(p_todo_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.todos%ROWTYPE;
  actor UUID := auth.uid();
  a RECORD;
  conflicts UUID[];
  c_count INT := 0;
  n_count INT := 0;
  res_id UUID;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO t FROM public.todos WHERE id = p_todo_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'todo not found';
  END IF;

  IF NOT public.is_space_member(t.space_id) THEN
    RAISE EXCEPTION 'not a member';
  END IF;

  FOR a IN
    SELECT ta.user_id
    FROM public.todo_assignees ta
    WHERE ta.todo_id = p_todo_id
  LOOP
    -- 指派通知（不给操作者自己）
    IF a.user_id <> actor THEN
      INSERT INTO public.notifications (user_id, space_id, type, title, body, payload)
      VALUES (
        a.user_id,
        t.space_id,
        'assigned',
        '你被指派了新任务',
        t.title,
        jsonb_build_object('todo_id', t.id, 'by', actor)
      );
      n_count := n_count + 1;
    END IF;

    -- 有排期则检测该指派人冲突
    IF t.start_at IS NOT NULL AND t.end_at IS NOT NULL AND t.status <> 'done' THEN
      SELECT ARRAY_AGG(c.id) INTO conflicts
      FROM public.check_schedule_conflicts(
        t.space_id, a.user_id, t.start_at, t.end_at, t.id
      ) c;

      IF conflicts IS NOT NULL AND cardinality(conflicts) > 0 THEN
        INSERT INTO public.conflict_resolutions (
          space_id, todo_id, user_id, creator_id, conflicting_todo_ids, status
        )
        VALUES (
          t.space_id, t.id, a.user_id, t.creator_id, conflicts, 'pending'
        )
        RETURNING id INTO res_id;

        INSERT INTO public.notifications (user_id, space_id, type, title, body, payload)
        VALUES (
          a.user_id,
          t.space_id,
          'conflict',
          '日程冲突提醒',
          '任务「' || t.title || '」与你现有日程重叠',
          jsonb_build_object(
            'todo_id', t.id,
            'resolution_id', res_id,
            'conflicting_todo_ids', to_jsonb(conflicts)
          )
        );
        c_count := c_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'assigned_notifications', n_count,
    'conflict_resolutions', c_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_todo_assignment(UUID) TO authenticated;

-- 被指派人：自己解决冲突（改期后调用）
CREATE OR REPLACE FUNCTION public.resolve_conflict_self(p_resolution_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.conflict_resolutions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO r FROM public.conflict_resolutions WHERE id = p_resolution_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolution not found';
  END IF;
  IF r.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'only assignee can self-resolve';
  END IF;
  IF r.status <> 'pending' AND r.status <> 'escalated' THEN
    RAISE EXCEPTION 'resolution already closed';
  END IF;

  UPDATE public.conflict_resolutions
  SET status = 'self_resolved',
      resolved_at = NOW(),
      updated_at = NOW()
  WHERE id = p_resolution_id;

  -- 通知创建人
  INSERT INTO public.notifications (user_id, space_id, type, title, body, payload)
  VALUES (
    r.creator_id,
    r.space_id,
    'conflict',
    '冲突已由对方自行解决',
    '被指派人已调整自己的日程',
    jsonb_build_object('resolution_id', r.id, 'todo_id', r.todo_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_conflict_self(UUID) TO authenticated;

-- 被指派人：把冲突打回创建人
CREATE OR REPLACE FUNCTION public.escalate_conflict_resolution(p_resolution_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.conflict_resolutions%ROWTYPE;
  ttitle TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO r FROM public.conflict_resolutions WHERE id = p_resolution_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolution not found';
  END IF;
  IF r.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'only assignee can escalate';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'resolution not pending';
  END IF;

  SELECT title INTO ttitle FROM public.todos WHERE id = r.todo_id;

  UPDATE public.conflict_resolutions
  SET status = 'escalated',
      updated_at = NOW()
  WHERE id = p_resolution_id;

  INSERT INTO public.notifications (user_id, space_id, type, title, body, payload)
  VALUES (
    r.creator_id,
    r.space_id,
    'conflict',
    '冲突已打回给你',
    '被指派人无法自行消化「' || COALESCE(ttitle, '任务') || '」的冲突，请重新排期或换人',
    jsonb_build_object(
      'resolution_id', r.id,
      'todo_id', r.todo_id,
      'from_user', auth.uid(),
      'conflicting_todo_ids', to_jsonb(r.conflicting_todo_ids)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.escalate_conflict_resolution(UUID) TO authenticated;

-- 创建人处理完升级冲突后关闭
CREATE OR REPLACE FUNCTION public.dismiss_conflict_resolution(p_resolution_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.conflict_resolutions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO r FROM public.conflict_resolutions WHERE id = p_resolution_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolution not found';
  END IF;
  IF r.creator_id <> auth.uid() AND r.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  UPDATE public.conflict_resolutions
  SET status = 'dismissed',
      resolved_at = NOW(),
      updated_at = NOW()
  WHERE id = p_resolution_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dismiss_conflict_resolution(UUID) TO authenticated;
