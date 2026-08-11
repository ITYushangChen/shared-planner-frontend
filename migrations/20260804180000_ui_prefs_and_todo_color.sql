-- 用户外观偏好（全局）+ 空间成员外观（按空间覆盖）+ 待办自定义色

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ui_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.ui_prefs IS
  '全局外观：bgColor / bgImageUrl / priorityColors{high,medium,low}';

ALTER TABLE public.space_members
  ADD COLUMN IF NOT EXISTS ui_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.space_members.ui_prefs IS
  '该用户在此空间的外观覆盖：bgColor / bgImageUrl；空则回退全局';

ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS color TEXT;

COMMENT ON COLUMN public.todos.color IS
  '任务展示/日历色（#RRGGBB）；空则用用户优先级色或系统默认';

-- 成员可更新自己的行（用于保存空间级外观偏好）
DROP POLICY IF EXISTS "members_update_self_prefs" ON public.space_members;
CREATE POLICY "members_update_self_prefs"
  ON public.space_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
