/**
 * Copies spot embeddings from the local PGlite dev database into Tiger Cloud (pgvector),
 * so moving databases doesn't spend Gemini quota twice.   npx tsx scripts/copy-embeddings.ts
 */
import "../server/src/config.js";
import { PGlite } from "@electric-sql/pglite";
import { getDb } from "../server/src/db/index.js";

const local = await PGlite.create(".data/pglite");
const rows = (await local.query<any>("SELECT spot_id, model, embedding FROM spot_embeddings")).rows;
await local.close();
const db = await getDb();
const ext = await db.one("SELECT 1 AS ok FROM pg_extension WHERE extname='vector'");
if (!ext) throw new Error("pgvector not enabled on the target database");
let n = 0;
for (let i = 0; i < rows.length; i += 50) {
  const part = rows.slice(i, i + 50);
  const vals: unknown[] = [];
  const sql = part
    .map((r, j) => {
      vals.push(r.spot_id, r.model, `[${(r.embedding as number[]).join(",")}]`);
      return `($${j * 3 + 1},$${j * 3 + 2},$${j * 3 + 3}::vector)`;
    })
    .join(",");
  await db.query(`INSERT INTO spot_embeddings (spot_id, model, embedding) VALUES ${sql} ON CONFLICT (spot_id) DO UPDATE SET embedding=EXCLUDED.embedding`, vals);
  n += part.length;
}
const c = await db.one("SELECT count(*)::int AS n FROM spot_embeddings");
console.log(`copied ${n}; Tiger now has ${c.n} embeddings (pgvector)`);
await db.close();
