-- 冲突检测改为跨空间：同一指派人在任意空间的时段重叠均计入，并通知

CREATE OR REPLACE FUNCTION public.check_schedule_conflicts(
  p_space_id UUID,
  p_user_id UUID,
  p_start_at TIMESTAMPTZ,
  p_end_at TIMESTAMPTZ,
  p_exclude_todo_id UUID DEFAULT NULL
)
RETURNS SETOF public.todos
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- p_space_id：调用上下文空间（须为成员）；冲突任务可来自该用户参与的任意空间
  SELECT t.*
  FROM public.todos t
  JOIN public.todo_assignees a ON a.todo_id = t.id
  WHERE a.user_id = p_user_id
    AND t.status <> 'done'
    AND t.time_range IS NOT NULL
    AND t.time_range && tstzrange(p_start_at, p_end_at, '[)')
    AND (p_exclude_todo_id IS NULL OR t.id <> p_exclude_todo_id)
    -- 用户 JWT：须为上下文空间成员；service_role（AI API）跳过
    AND (auth.uid() IS NULL OR public.is_space_member(p_space_id))
    AND EXISTS (
      SELECT 1
      FROM public.space_members sm
      WHERE sm.space_id = t.space_id
        AND sm.user_id = p_user_id
    );
$$;

COMMENT ON FUNCTION public.check_schedule_conflicts(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) IS
  '检测指派人时段冲突（跨空间）；p_space_id 为操作上下文空间';

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
  existing_id UUID;
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

    -- 有排期则跨空间检测该指派人冲突
    IF t.start_at IS NOT NULL AND t.end_at IS NOT NULL AND t.status <> 'done' THEN
      SELECT ARRAY_AGG(c.id) INTO conflicts
      FROM public.check_schedule_conflicts(
        t.space_id, a.user_id, t.start_at, t.end_at, t.id
      ) c;

      IF conflicts IS NOT NULL AND cardinality(conflicts) > 0 THEN
        SELECT cr.id INTO existing_id
        FROM public.conflict_resolutions cr
        WHERE cr.todo_id = t.id
          AND cr.user_id = a.user_id
          AND cr.status IN ('pending', 'escalated')
        ORDER BY cr.created_at DESC
        LIMIT 1;

        IF existing_id IS NOT NULL THEN
          UPDATE public.conflict_resolutions
          SET conflicting_todo_ids = conflicts,
              updated_at = NOW()
          WHERE id = existing_id;
          res_id := existing_id;
          -- 已有待处理单：只刷新重叠列表，不重复发消息
        ELSE
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
            '任务「' || t.title || '」与你现有日程重叠（含其他空间）',
            jsonb_build_object(
              'todo_id', t.id,
              'resolution_id', res_id,
              'conflicting_todo_ids', to_jsonb(conflicts)
            )
          );
          c_count := c_count + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'assigned_notifications', n_count,
    'conflict_resolutions', c_count
  );
END;
$$;
