import { createHash, randomBytes, randomInt } from "node:crypto";

export const newId = (prefix = "") => prefix + randomBytes(9).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
export const sixDigitCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const friendCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[randomInt(0, alphabet.length)]).join("");
};

export class HttpError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<{ ok: true; value: T } | { ok: false; timedOut: true; promise: Promise<T> }> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<"__timeout">((r) => (t = setTimeout(() => r("__timeout"), ms)));
  const res = await Promise.race([p, timeout]);
  clearTimeout(t!);
  if (res === "__timeout") return { ok: false, timedOut: true, promise: p };
  return { ok: true, value: res as T };
}

/** Simple fixed-window rate limiter, per key. */
const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= max;
}

export const firstName = (displayName: string) => displayName.split(/\s+/)[0];
