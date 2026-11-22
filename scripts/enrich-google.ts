/**
 * Fills in ratings, real price ranges, verified hours and closed status from Google Places API (New)
 * for the food spots closest to T stations. Writes data/google-places.json; the server applies it at boot.
 * Resumable: spots already looked up are skipped.
 *   GOOGLE_API_KEY=... npm run enrich:google -- [how many, default 400]
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "./lib.js";
import { searchPlace } from "../server/src/services/googlePlaces.js";

const key = process.env.GOOGLE_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
if (!key) { console.error("Set GOOGLE_API_KEY in .env (Places API (New) enabled)."); process.exit(1); }
const LIMIT = Number(process.argv[2] || 400);
const OUT = resolve(DATA_DIR, "google-places.json");

const spots: any[] = JSON.parse(readFileSync(resolve(DATA_DIR, "spots.json"), "utf8")).spots.filter((s: any) => s.kind === "food");
const tf = existsSync(resolve(DATA_DIR, "tfield.json")) ? JSON.parse(readFileSync(resolve(DATA_DIR, "tfield.json"), "utf8")).newSpots : [];
const done = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { places: {} as Record<string, any> };
const todo = [...spots, ...tf].filter((s) => !done.places[s.id]).sort((a, b) => a.distanceM - b.distanceM).slice(0, LIMIT);
console.log(`Looking up ${todo.length} spots (${Object.keys(done.places).length} already done)`);

let n = 0, matched = 0, failed = 0;
const save = () => writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), source: "Google Places API (New) Text Search", places: done.places }));
const queue = [...todo];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const s = queue.shift()!;
    try {
      const r = await searchPlace(key, s);
      done.places[s.id] = { ...r, checkedAt: new Date().toISOString().slice(0, 10) };
      if (r.matched) matched++;
    } catch (e) {
      failed++;
      console.warn(`  ${s.name}: ${(e as Error).message}`);
      if (/40[13]/.test((e as Error).message)) { console.error("Key rejected. Check that Places API (New) is enabled for it."); queue.length = 0; }
    }
    if (++n % 25 === 0) { save(); console.log(`  ${n}/${todo.length} · ${matched} matched`); }
  }
}));
save();
console.log(`Done: ${matched} of ${n} matched to a Google listing${failed ? `, ${failed} failed` : ""}. Restart the server to apply.`);
