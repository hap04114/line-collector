/**
 * Bakes MBTA subway routes, stations and line shapes into data/mbta.json so the
 * app starts instantly and still draws the map if the MBTA API is down.
 * Live trains, alerts and predictions are still fetched at runtime by the poller.
 *
 *   npm run bake:mbta
 */
import { getJson, writeData, decodePolyline, sleep } from "./lib.js";

const BASE = "https://api-v3.mbta.com";
const KEY = process.env.MBTA_API_KEY;
const ROUTES = ["Red", "Mattapan", "Orange", "Blue", "Green-B", "Green-C", "Green-D", "Green-E"];
// Without a key the MBTA allows ~20 requests a minute.
const PAUSE = KEY ? 150 : 3200;

const q = (path: string) => `${BASE}${path}${path.includes("?") ? "&" : "?"}${KEY ? `api_key=${KEY}` : ""}`;

async function main() {
  const routesRes = await getJson(q(`/routes?filter[id]=${ROUTES.join(",")}`));
  const routes: any[] = [];
  const stations = new Map<string, any>();
  const shapes: any[] = [];

  for (const id of ROUTES) {
    const r = routesRes.data.find((x: any) => x.id === id);
    if (!r) throw new Error(`route ${id} missing`);
    console.log(`route ${id}`);
    await sleep(PAUSE);
    const stops = await getJson(q(`/stops?filter[route]=${id}&filter[direction_id]=0`));
    await sleep(PAUSE);
    const patterns = await getJson(
      q(`/route_patterns?filter[route]=${id}&filter[canonical]=true&include=representative_trip.shape`),
    );

    const stopIds: string[] = [];
    for (const s of stops.data) {
      const a = s.attributes;
      stopIds.push(s.id);
      const existing = stations.get(s.id);
      if (existing) existing.routes.push(id);
      else
        stations.set(s.id, {
          id: s.id,
          name: a.name,
          lat: a.latitude,
          lon: a.longitude,
          municipality: a.municipality,
          wheelchair: a.wheelchair_boarding === 1,
          routes: [id],
        });
    }

    const seen = new Set<string>();
    for (const inc of patterns.included || []) {
      if (inc.type !== "shape" || !inc.id.startsWith("canonical")) continue;
      const coords = decodePolyline(inc.attributes.polyline);
      const key = `${coords[0]}|${coords[coords.length - 1]}`;
      const rev = `${coords[coords.length - 1]}|${coords[0]}`;
      if (seen.has(key) || seen.has(rev)) continue; // keep one direction per branch
      seen.add(key);
      shapes.push({ routeId: id, shapeId: inc.id, coords });
    }

    const a = r.attributes;
    routes.push({
      id,
      name: a.long_name,
      short: id.startsWith("Green-") ? id.replace("Green-", "Green ") : a.long_name.replace(" Line", ""),
      color: `#${a.color}`,
      textColor: `#${a.text_color}`,
      type: a.type,
      stopIds,
    });
  }

  writeData("mbta.json", {
    bakedAt: new Date().toISOString(),
    source: "MBTA V3 API",
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
