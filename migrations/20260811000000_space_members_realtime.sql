-- 侧边栏空间导航实时同步：把 space_members 加入 realtime 发布
-- 若发布已包含全部表（FOR ALL TABLES），pg_publication_tables 也会列出该表，守卫自动跳过
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'space_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.space_members;
  END IF;
END $$;
