-- 每个空间同时最多一条 pending 邀请码；须撤销后才能再生成

-- 清理历史：同一空间多余 pending 只保留最新一条，其余撤销
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY space_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.space_invitations
  WHERE status = 'pending'
)
UPDATE public.space_invitations si
SET status = 'revoked'
FROM ranked r
WHERE si.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS space_invitations_one_pending_per_space
  ON public.space_invitations (space_id)
  WHERE status = 'pending';

COMMENT ON INDEX public.space_invitations_one_pending_per_space IS
  '每个空间仅允许一条有效（pending）邀请码';
