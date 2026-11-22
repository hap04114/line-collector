/**
 * Upgrades heuristic vibe tags (cozy, photogenic, good for groups, quiet, late-night, quick bite)
 * to Gemini-generated tags for food spots, in batches. Needs GEMINI_API_KEY.
 *
 *   npm run bake:vibes                     # all stations
 *   npm run bake:vibes -- place-nuniv place-bucen   # just these stations (demo stops first)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR, writeData, sleep } from "./lib.js";
import { geminiEnabled, vibeTagsAI } from "../server/src/lib/gemini.js";

const ALLOWED = new Set(["cozy", "photogenic", "good for groups", "quiet", "late-night", "quick bite"]);

async function main() {
  if (!geminiEnabled()) {
    console.error("Set GEMINI_API_KEY in .env first.");
    process.exit(1);
  }
  const only = process.argv.slice(2).filter((a) => a.startsWith("place-"));
  const file = JSON.parse(readFileSync(resolve(DATA_DIR, "spots.json"), "utf8"));
  const targets = file.spots.filter((s: any) => s.kind === "food" && (!only.length || only.includes(s.stationId)) && s.vibeSource !== "gemini");
  console.log(`${targets.length} spots to tag`);
  for (let i = 0; i < targets.length; i += 40) {
    const batch = targets.slice(i, i + 40);
    try {
      const tags = await vibeTagsAI(batch.map((s: any) => ({ id: s.id, name: s.name, amenity: s.amenity, cuisines: s.cuisines })));
      for (const s of batch) {
        const t = (tags[s.id] || []).filter((x) => ALLOWED.has(x));
        if (t.length) {
          s.vibes = t;
          s.vibeSource = "gemini";
        }
      }
      console.log(`  tagged ${Math.min(i + 40, targets.length)}/${targets.length}`);
    } catch (e) {
      console.warn(`  batch failed: ${(e as Error).message}`);
    }
    await sleep(800);
  }
  writeData("spots.json", file);
  console.log("Restart the server to load the new tags.");
}

main();
