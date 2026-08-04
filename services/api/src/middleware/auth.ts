import type { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { getUserFromToken } from "../lib/supabase";
import type { AuthContext } from "../lib/space";

export type AuthedRequest = Request & { auth?: AuthContext };

export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing Bearer token" });
      return;
    }
    const accessToken = header.slice("Bearer ".length).trim();
    const user = await getUserFromToken(accessToken);
    req.auth = { user, accessToken };
    next();
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : "Unauthorized",
    });
  }
}

export function requireCronSecret(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!config.cronSecret) {
    res.status(500).json({ error: "CRON_SECRET is not configured" });
    return;
  }
  const secret = req.header("x-cron-secret");
  if (secret !== config.cronSecret) {
    res.status(401).json({ error: "Invalid cron secret" });
    return;
  }
  next();
}
