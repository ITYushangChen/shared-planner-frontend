-- 空间类型：由用户自选（工作区 / 生活区 / 家庭区等）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'space_kind') THEN
    CREATE TYPE public.space_kind AS ENUM (
      'personal',
      'work',
      'life',
      'family',
      'other'
    );
  END IF;
END $$;

ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS kind public.space_kind NOT NULL DEFAULT 'personal';

COMMENT ON COLUMN public.spaces.kind IS '空间类型：personal/work/life/family/other，用户可自设';

CREATE INDEX IF NOT EXISTS idx_spaces_kind ON public.spaces(kind);

-- 注册 Trigger：默认个人空间
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_space_id UUID;
  uname TEXT;
BEGIN
  uname := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    split_part(NEW.email, '@', 1),
    'User'
  );

  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, uname);

  INSERT INTO public.spaces (name, description, owner_id, kind)
  VALUES (uname || '的空间', '个人默认空间', NEW.id, 'personal')
  RETURNING id INTO new_space_id;

  INSERT INTO public.space_members (space_id, user_id, role)
  VALUES (new_space_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$;

-- 登录兜底：默认个人空间带 kind
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
    INSERT INTO public.spaces (name, description, owner_id, kind)
    VALUES (uname || '的空间', '个人默认空间', uid, 'personal')
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
