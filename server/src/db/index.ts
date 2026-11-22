/**
 * One tiny query interface over two engines:
 *  - Postgres with TimescaleDB (Tiger Cloud) when DATABASE_URL is set
 *  - embedded PGlite (Postgres compiled to WASM) otherwise, so `npm run dev` needs no setup
 * The schema is the same; Timescale-only parts (hypertables, continuous aggregates,
 * policies) are applied only when the extension is available. See schema.ts.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { config, STATE_DIR } from "../config.js";

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  kind: "postgres" | "pglite";
  timescale: boolean;
  /** continuous aggregates actually created (Timescale only) */
  caggs?: string[];
  /** pgvector available (Tiger Cloud) */
  vector?: boolean;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

// pg returns int8/numeric as strings; make both engines return numbers.
pg.types.setTypeParser(20, (v) => parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => parseFloat(v));
// DATE stays a plain 'YYYY-MM-DD' string (no timezone shift)
pg.types.setTypeParser(1082, (v) => v);

let _db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (_db) return _db;
  _db = config.databaseUrl ? await openPostgres(config.databaseUrl) : await openPglite();
  return _db;
}

async function openPostgres(url: string): Promise<Db> {
  const pool = new pg.Pool({
    connectionString: url,
    max: 8,
    ssl: /sslmode=(require|verify)/.test(url) || /tsdb\.cloud|timescale/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  pool.on("error", (e) => console.error("[db] pool error", e.message));
  const query = async <T,>(sql: string, params?: unknown[]) => (await pool.query(sql, params as any[])).rows as T[];
  let timescale = false;
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS timescaledb");
  } catch {
    /* not available or no permission; checked below */
  }
  const ext = await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'");
  timescale = (ext.rowCount ?? 0) > 0;
  return {
    kind: "postgres",
    timescale,
    query,
    one: async (sql, params) => (await query<any>(sql, params))[0] ?? null,
    exec: async (sql) => void (await pool.query(sql)),
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({ query: async (s, p) => (await client.query(s, p as any[])).rows });
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openPglite(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = resolve(STATE_DIR, "pglite");
  mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir, { parsers: { 1082: (v: string) => v } });
  const query = async <T,>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params as any[])).rows;
  return {
    kind: "pglite",
    timescale: false,
    query,
    one: async (sql, params) => (await query<any>(sql, params))[0] ?? null,
    exec: async (sql) => void (await db.exec(sql)),
    tx: (fn) => db.transaction((t) => fn({ query: async (s, p) => (await t.query<any>(s, p as any[])).rows })),
    close: () => db.close(),
  };
}
