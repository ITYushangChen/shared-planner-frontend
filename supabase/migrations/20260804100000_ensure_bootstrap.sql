-- 登录后兜底：若 Trigger 未写入 profile/空间，可由登录用户自行补齐
CREATE OR REPLACE FUNCTION public.ensure_my_bootstrap()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  uname TEXT;
  uemail TEXT;
  sid UUID;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT
    COALESCE(raw_user_meta_data->>'display_name', split_part(email, '@', 1), 'User'),
    email
  INTO uname, uemail
  FROM auth.users
  WHERE id = uid;

  INSERT INTO public.profiles (id, email, display_name)
  VALUES (uid, uemail, uname)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        display_name = COALESCE(public.profiles.display_name, EXCLUDED.display_name),
        updated_at = NOW();

  SELECT s.id INTO sid
  FROM public.spaces s
  JOIN public.space_members sm ON sm.space_id = s.id
  WHERE sm.user_id = uid
  ORDER BY sm.joined_at ASC
  LIMIT 1;

  IF sid IS NULL THEN
    INSERT INTO public.spaces (name, description, owner_id)
    VALUES (uname || '的空间', '个人默认空间', uid)
    RETURNING id INTO sid;

    INSERT INTO public.space_members (space_id, user_id, role)
    VALUES (sid, uid, 'owner')
    ON CONFLICT (space_id, user_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'user_id', uid,
    'space_id', sid,
    'display_name', uname
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_my_bootstrap() TO authenticated;
