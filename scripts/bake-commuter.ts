/**
 * Bakes MBTA Commuter Rail lines, stops and shapes into data/commuter-rail.json.
 * Kept separate from data/mbta.json on purpose: Commuter Rail shows on the map and in
 * Street Runner, while check-ins, badges and the school board stay subway-only.
 *
 *   npm run bake:commuter
 */
import { getJson, writeData, decodePolyline, sleep } from "./lib.js";

const BASE = "https://api-v3.mbta.com";
const KEY = process.env.MBTA_API_KEY;
const PAUSE = KEY ? 150 : 3200; // ~20 requests a minute without a key
const q = (path: string) => `${BASE}${path}${path.includes("?") ? "&" : "?"}${KEY ? `api_key=${KEY}` : ""}`;

async function main() {
  const routesRes = await getJson(q(`/routes?filter[type]=2`));
  const routes: any[] = [];
  const stations = new Map<string, any>();
  const shapes: any[] = [];

  for (const r of routesRes.data) {
    const id: string = r.id;
    const a = r.attributes;
    console.log(`route ${id}`);
    await sleep(PAUSE);
    const stops = await getJson(q(`/stops?filter[route]=${id}&filter[direction_id]=0`));
    await sleep(PAUSE);
    const patterns = await getJson(q(`/route_patterns?filter[route]=${id}&filter[canonical]=true&include=representative_trip.shape`));

    const stopIds: string[] = [];
    for (const s of stops.data) {
      const sa = s.attributes;
      stopIds.push(s.id);
      const existing = stations.get(s.id);
      if (existing) existing.routes.push(id);
      else stations.set(s.id, { id: s.id, name: sa.name, lat: sa.latitude, lon: sa.longitude, municipality: sa.municipality, routes: [id] });
    }

    const seen = new Set<string>();
    for (const inc of patterns.included || []) {
      if (inc.type !== "shape") continue;
      const coords = decodePolyline(inc.attributes.polyline);
      if (coords.length < 2) continue;
      const key = `${coords[0]}|${coords[coords.length - 1]}`;
      const rev = `${coords[coords.length - 1]}|${coords[0]}`;
      if (seen.has(key) || seen.has(rev)) continue;
      seen.add(key);
      shapes.push({ routeId: id, shapeId: inc.id, coords });
    }

    routes.push({
      id,
      name: a.long_name,
      short: String(a.long_name).replace(/ Line$/, ""),
      color: `#${a.color}`,
      textColor: `#${a.text_color}`,
      type: a.type,
      stopIds,
    });
  }

  writeData("commuter-rail.json", {
    bakedAt: new Date().toISOString(),
    source: "MBTA V3 API (Commuter Rail)",
    routes,
    stations: [...stations.values()],
    shapes,
  });
  console.log(`${routes.length} routes, ${stations.size} stations, ${shapes.length} shapes`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
