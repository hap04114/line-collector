/**
 * Merges dietary tags from our team's T-Field places.json (OSM diet:* tags) into data/spots.json.
 * Keeps only positive values ("options" or "only"); "inferred" ones are marked so the UI can say so.
 *   npm run merge:diet -- [path to t-field/web/public/data]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR, ROOT } from "./lib.js";

const SRC = resolve(process.argv[2] || resolve(ROOT, "../t-field/web/public/data"));
const tf = JSON.parse(readFileSync(resolve(SRC, "places.json"), "utf8"));
const byId = new Map<string, any>((tf.places || tf).map((p: any) => [p.id.replace("osm:", "osm-"), p]));
const file = JSON.parse(readFileSync(resolve(DATA_DIR, "spots.json"), "utf8"));
let n = 0;
for (const s of file.spots) {
  const p = byId.get(s.id);
  const diet: string[] = [];
  if (p) for (const [k, v] of Object.entries<any>(p.diet)) if (v.level === "options" || v.level === "only") diet.push(v.confidence === "inferred" ? `${k}?` : k);
  s.diet = diet;
  if (diet.length) n++;
}
writeFileSync(resolve(DATA_DIR, "spots.json"), JSON.stringify(file));
console.log(`${n} spots now carry diet tags`);
