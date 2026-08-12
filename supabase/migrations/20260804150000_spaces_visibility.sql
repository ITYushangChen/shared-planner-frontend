-- 空间可见性：private 私人 / public 公共（便于邀请协作）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'spaces'
      AND column_name = 'visibility'
  ) THEN
    ALTER TABLE public.spaces
      ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
      CHECK (visibility IN ('private', 'public'));
  END IF;
END $$;

COMMENT ON COLUMN public.spaces.visibility IS 'private=私人空间；public=公共协作空间（创建时可生成邀请码）';

CREATE INDEX IF NOT EXISTS idx_spaces_visibility ON public.spaces(visibility);
