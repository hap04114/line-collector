/**
 * Builds Gemini embeddings for every food/hangout spot and stores them in the database
 * (pgvector on Tiger Cloud; float arrays on local PGlite). Powers "search by meaning" in Find.
 * Needs GEMINI_API_KEY (and DATABASE_URL for Tiger).   npm run embed:spots
 */
import "../server/src/config.js";
import { getDb } from "../server/src/db/index.js";
import { migrate } from "../server/src/db/schema.js";
import { EMBED_MODEL, embedTexts, geminiEnabled } from "../server/src/lib/gemini.js";
import { stationById } from "../server/src/lib/static.js";
import { SCHOOLS } from "../server/src/data/schools.js";
import { haversineM } from "../server/src/lib/geo.js";

const LIMIT = Number(process.argv[process.argv.indexOf("--limit") + 1]) || 900;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!geminiEnabled()) {
  console.error("Set GEMINI_API_KEY in .env first.");
  process.exit(1);
}
const db = await getDb();
await migrate(db);
const done = new Set((await db.query<{ spot_id: string }>("SELECT spot_id FROM spot_embeddings")).map((r) => r.spot_id));
const spots = (await db.query("SELECT id, name, kind, amenity, cuisines, vibes, diet, station_id, description FROM spots WHERE kind IN ('food','landmark','hangout')")).filter((s: any) => !done.has(s.id))
  // free-tier quota: spots closest to the seven campuses first
  .map((s: any) => ({ s, d: Math.min(...SCHOOLS.map((c) => haversineM(c.lat, c.lon, stationById.get(s.station_id)?.lat ?? 0, stationById.get(s.station_id)?.lon ?? 0))) }))
  .sort((a: any, b: any) => a.d - b.d)
  .slice(0, LIMIT)
  .map((x: any) => x.s);
console.log(`${spots.length} spots to embed (${done.size} already done) with ${EMBED_MODEL}, pgvector: ${!!db.vector}`);
const text = (s: any) =>
  [s.name, s.amenity?.replace(/_/g, " "), s.cuisines?.join(", ").replace(/_/g, " "), s.vibes?.join(", "), s.diet?.join(", ").replace(/[_?]/g, " "), s.description, `near ${stationById.get(s.station_id)?.name ?? ""} station`]
    .filter(Boolean).join(". ");
for (let i = 0; i < spots.length; i += 90) {
  const batch = spots.slice(i, i + 90);
  if (i > 0) await sleep(62_000); // stay under the per-minute embedding quota
  for (let attempt = 0; attempt < 3; attempt++) try {
    const vecs = await embedTexts(batch.map(text), "RETRIEVAL_DOCUMENT");
    for (const [j, s] of batch.entries()) {
      const v = db.vector ? `[${vecs[j].join(",")}]` : vecs[j];
      await db.query(
        `INSERT INTO spot_embeddings (spot_id, model, embedding) VALUES ($1,$2,$3${db.vector ? "::vector" : ""}) ON CONFLICT (spot_id) DO UPDATE SET embedding=EXCLUDED.embedding, model=EXCLUDED.model`,
        [s.id, EMBED_MODEL, v],
      );
    }
    console.log(`  ${Math.min(i + 90, spots.length)}/${spots.length}`);
    break;
  } catch (e) {
    const msg = (e as Error).message;
    console.warn(`  batch failed (attempt ${attempt + 1}): ${msg.slice(0, 80)}`);
    if (/per day|PerDay/i.test(msg)) { console.warn("  daily quota reached; run again tomorrow or enable billing"); i = spots.length; break; }
    await sleep(65_000);
  }
}
await db.close();
