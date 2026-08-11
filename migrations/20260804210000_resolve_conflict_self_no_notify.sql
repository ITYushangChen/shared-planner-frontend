-- 被指派人「自己解决」冲突时只关单，不再通知创建人（通知仅在「发给创建人」时发送）

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
END;
$$;
