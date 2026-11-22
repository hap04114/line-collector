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

if (!geminiEnabled()) {
  console.error("Set GEMINI_API_KEY in .env first.");
  process.exit(1);
}
const db = await getDb();
await migrate(db);
const done = new Set((await db.query<{ spot_id: string }>("SELECT spot_id FROM spot_embeddings")).map((r) => r.spot_id));
const spots = (await db.query("SELECT id, name, kind, amenity, cuisines, vibes, diet, station_id, description FROM spots WHERE kind IN ('food','landmark','hangout')")).filter((s: any) => !done.has(s.id));
console.log(`${spots.length} spots to embed (${done.size} already done) with ${EMBED_MODEL}, pgvector: ${!!db.vector}`);
const text = (s: any) =>
  [s.name, s.amenity?.replace(/_/g, " "), s.cuisines?.join(", ").replace(/_/g, " "), s.vibes?.join(", "), s.diet?.join(", ").replace(/[_?]/g, " "), s.description, `near ${stationById.get(s.station_id)?.name ?? ""} station`]
    .filter(Boolean).join(". ");
for (let i = 0; i < spots.length; i += 90) {
  const batch = spots.slice(i, i + 90);
  try {
    const vecs = await embedTexts(batch.map(text), "RETRIEVAL_DOCUMENT");
    for (const [j, s] of batch.entries()) {
      const v = db.vector ? `[${vecs[j].join(",")}]` : vecs[j];
      await db.query(
        `INSERT INTO spot_embeddings (spot_id, model, embedding) VALUES ($1,$2,$3${db.vector ? "::vector" : ""}) ON CONFLICT (spot_id) DO UPDATE SET embedding=EXCLUDED.embedding, model=EXCLUDED.model`,
        [s.id, EMBED_MODEL, v],
      );
    }
    console.log(`  ${Math.min(i + 90, spots.length)}/${spots.length}`);
  } catch (e) {
    console.warn(`  batch failed: ${(e as Error).message}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
await db.close();
