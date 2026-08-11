-- 冲突协商：创建人=指派人不通知自己；打回创建人须填原因

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

  -- 自行解决不通知创建人；需对方处理时用 escalate
END;
$$;

DROP FUNCTION IF EXISTS public.escalate_conflict_resolution(UUID);

CREATE OR REPLACE FUNCTION public.escalate_conflict_resolution(
  p_resolution_id UUID,
  p_note TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.conflict_resolutions%ROWTYPE;
  ttitle TEXT;
  v_note TEXT := trim(COALESCE(p_note, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_note = '' THEN
    RAISE EXCEPTION 'reason required';
  END IF;

  SELECT * INTO r FROM public.conflict_resolutions WHERE id = p_resolution_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolution not found';
  END IF;
  IF r.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'only assignee can escalate';
  END IF;
  IF r.creator_id = r.user_id THEN
    RAISE EXCEPTION 'cannot escalate to yourself';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'resolution not pending';
  END IF;

  SELECT title INTO ttitle FROM public.todos WHERE id = r.todo_id;

  UPDATE public.conflict_resolutions
  SET status = 'escalated',
      note = v_note,
      updated_at = NOW()
  WHERE id = p_resolution_id;

  INSERT INTO public.notifications (user_id, space_id, type, title, body, payload)
  VALUES (
    r.creator_id,
    r.space_id,
    'conflict',
    '冲突已打回给你',
    '被指派人无法自行消化「' || COALESCE(ttitle, '任务') || '」的冲突。原因：' || v_note,
    jsonb_build_object(
      'resolution_id', r.id,
      'todo_id', r.todo_id,
      'from_user', auth.uid(),
      'note', v_note,
      'conflicting_todo_ids', to_jsonb(r.conflicting_todo_ids)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.escalate_conflict_resolution(UUID, TEXT) TO authenticated;
