/**
 * Sign-in is a link sent to a school inbox (a spoofed address can't receive it).
 * Sessions are random tokens in an httpOnly cookie; only the SHA-256 is stored.
 * Owners of partner spots sign in the same way with the email on their partner record.
 */
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { getDb } from "./db/index.js";
import { HttpError, randomToken, sha256 } from "./lib/util.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: any;
      ownerPartnerId?: string | null;
    }
  }
}

export const COOKIE = "lc_session";
const SESSION_DAYS = 30;

export async function createSession(res: Response, who: { userId?: string; ownerPartnerId?: string }) {
  const db = await getDb();
  const token = randomToken();
  await db.query(`INSERT INTO sessions (token_hash, user_id, owner_partner_id, expires_at) VALUES ($1,$2,$3,$4)`, [
    sha256(token), who.userId ?? null, who.ownerPartnerId ?? null, new Date(Date.now() + SESSION_DAYS * 86400_000),
  ]);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicUrl.startsWith("https://"),
    maxAge: SESSION_DAYS * 86400_000,
    path: "/",
  });
}

export async function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    const db = await getDb();
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [sha256(token)]);
  }
  res.clearCookie(COOKIE, { path: "/" });
}

export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  const db = await getDb();
  const s = await db.one(`SELECT * FROM sessions WHERE token_hash=$1 AND expires_at > now()`, [sha256(token)]);
  if (s?.user_id) req.user = await db.one("SELECT * FROM users WHERE id=$1", [s.user_id]);
  if (s?.owner_partner_id) req.ownerPartnerId = s.owner_partner_id;
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Sign in with your school email first"));
  next();
}

export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  if (!req.ownerPartnerId) return next(new HttpError(401, "Owner sign-in required"));
  next();
}

export async function issueLoginToken(email: string, purpose: "student" | "owner", displayName?: string) {
  const db = await getDb();
  const token = randomToken();
  await db.query(`INSERT INTO login_tokens (token_hash, email, purpose, display_name, expires_at) VALUES ($1,$2,$3,$4,$5)`, [
    sha256(token), email.toLowerCase(), purpose, displayName ?? null, new Date(Date.now() + 20 * 60_000),
  ]);
  return `${config.publicUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
}
