-- 已有 pending 冲突再改期仍冲突时：同样写入消息，便于铃铛/消息中心即时可见

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
  has_assignee BOOLEAN;
  conflict_title TEXT;
  conflict_body TEXT;
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

  SELECT EXISTS (
    SELECT 1 FROM public.todo_assignees WHERE todo_id = p_todo_id
  ) INTO has_assignee;

  FOR a IN
    SELECT u.user_id
    FROM (
      SELECT ta.user_id
      FROM public.todo_assignees ta
      WHERE ta.todo_id = p_todo_id
      UNION ALL
      SELECT t.creator_id
      WHERE NOT has_assignee
        AND t.creator_id IS NOT NULL
    ) u
  LOOP
    -- 指派通知（不给操作者自己；无指派回退创建人时不重复发「被指派」）
    IF has_assignee AND a.user_id <> actor THEN
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

    IF t.start_at IS NOT NULL AND t.end_at IS NOT NULL AND t.status <> 'done' THEN
      SELECT ARRAY_AGG(c.id) INTO conflicts
      FROM public.check_schedule_conflicts(
        t.space_id, a.user_id, t.start_at, t.end_at, t.id
      ) c;

      IF conflicts IS NOT NULL AND cardinality(conflicts) > 0 THEN
        conflict_title := '日程冲突提醒';
        conflict_body := CASE
          WHEN t.creator_id = a.user_id THEN
            '任务「' || t.title || '」与你现有日程重叠，请修改时段'
          ELSE
            '任务「' || t.title || '」与你现有日程重叠（含其他空间）'
        END;

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
        ELSE
          INSERT INTO public.conflict_resolutions (
            space_id, todo_id, user_id, creator_id, conflicting_todo_ids, status
          )
          VALUES (
            t.space_id, t.id, a.user_id, t.creator_id, conflicts, 'pending'
          )
          RETURNING id INTO res_id;
        END IF;

        INSERT INTO public.notifications (user_id, space_id, type, title, body, payload)
        VALUES (
          a.user_id,
          t.space_id,
          'conflict',
          conflict_title,
          conflict_body,
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
