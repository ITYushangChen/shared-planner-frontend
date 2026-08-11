-- 修复：新建空间后 .select() RETURNING 需能读到行
-- 原策略仅 is_space_member，插入时尚无 space_members，导致 RLS 报错
DROP POLICY IF EXISTS "spaces_select_member" ON public.spaces;

CREATE POLICY "spaces_select_member"
  ON public.spaces FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.is_space_member(id)
  );
