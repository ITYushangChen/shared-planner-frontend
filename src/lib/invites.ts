/** 生成可读邀请码（不含易混字符） */
export function generateInviteCode(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export type InviteRow = {
  id: string;
  code: string;
  invite_type: string;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  status: "pending" | "accepted" | "expired" | "revoked";
  created_at: string;
};
