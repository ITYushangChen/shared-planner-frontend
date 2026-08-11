-- 外观背景图上传桶：公开读，仅本人可写自己目录

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'backgrounds',
  'backgrounds',
  TRUE,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "backgrounds_public_read" ON storage.objects;
CREATE POLICY "backgrounds_public_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'backgrounds');

DROP POLICY IF EXISTS "backgrounds_insert_own" ON storage.objects;
CREATE POLICY "backgrounds_insert_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'backgrounds'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "backgrounds_update_own" ON storage.objects;
CREATE POLICY "backgrounds_update_own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'backgrounds'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'backgrounds'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "backgrounds_delete_own" ON storage.objects;
CREATE POLICY "backgrounds_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'backgrounds'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
