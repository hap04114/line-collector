/**
 * Object storage. Vultr Object Storage (S3-compatible) when VULTR_S3_* is set, else local disk.
 * Used for: sublet photos (public), check-in photos (private, for audit), nightly database backups (private).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { STATE_DIR } from "../config.js";
import type { Db } from "../db/index.js";

const S3 = {
  endpoint: process.env.VULTR_S3_ENDPOINT || "", // e.g. https://ewr1.vultrobjects.com
  bucket: process.env.VULTR_S3_BUCKET || "",
  accessKey: process.env.VULTR_S3_ACCESS_KEY || "",
  secretKey: process.env.VULTR_S3_SECRET_KEY || "",
};
export const storageProvider = () => (S3.endpoint && S3.bucket && S3.accessKey && S3.secretKey ? "Vultr Object Storage" : "local disk");
export const stats = { puts: 0, lastKey: null as string | null, lastBackup: null as string | null, lastError: null as string | null };

let client: any = null;
async function s3() {
  if (client) return client;
  const { S3Client } = await import("@aws-sdk/client-s3");
  client = new S3Client({ endpoint: S3.endpoint, region: "us-east-1", credentials: { accessKeyId: S3.accessKey, secretAccessKey: S3.secretKey } });
  return client;
}

/** Stores an object; returns a URL for public objects (or a local /uploads path). */
export async function putObject(key: string, body: Buffer, contentType: string, isPublic: boolean): Promise<string> {
  stats.puts++;
  stats.lastKey = key;
  if (storageProvider() === "local disk") {
    const path = resolve(STATE_DIR, "uploads", key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    return `/uploads/${key}`;
  }
  try {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await s3()).send(new PutObjectCommand({ Bucket: S3.bucket, Key: key, Body: body, ContentType: contentType, ACL: isPublic ? "public-read" : "private" }));
    return `${S3.endpoint.replace(/\/$/, "")}/${S3.bucket}/${key}`;
  } catch (e) {
    stats.lastError = (e as Error).message;
    throw e;
  }
}

const BACKUP_TABLES = ["schools", "users", "spots", "checkins", "collections", "user_neighborhoods", "badges", "tips", "partners", "offers", "redemptions", "events", "sublets", "rides", "study_ratings", "menu_items", "arcade_scores"];

/** Exports the app tables as gzipped JSON to storage (Vultr in production). */
export async function backupNow(db: Db): Promise<string> {
  const out: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) {
    try {
      out[t] = await db.query(`SELECT * FROM ${t}`);
    } catch {
      out[t] = [];
    }
  }
  const key = `backups/${new Date().toISOString().slice(0, 10)}.json.gz`;
  await putObject(key, gzipSync(Buffer.from(JSON.stringify({ at: new Date().toISOString(), tables: out }))), "application/gzip", false);
  stats.lastBackup = new Date().toISOString();
  return key;
}

export function scheduleBackups(db: Db) {
  // once at boot (after seeding settles) and then every 24 hours
  setTimeout(() => backupNow(db).catch((e) => console.warn("[backup]", e.message)), 90_000).unref();
  setInterval(() => backupNow(db).catch((e) => console.warn("[backup]", e.message)), 24 * 3600_000).unref();
}
