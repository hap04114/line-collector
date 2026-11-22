/** In-memory index of the baked data files (MBTA, neighborhoods, spots, rent cache). */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "../config.js";
import { SCHOOLS } from "../data/schools.js";
import { BONUS_BY_MUNICIPALITY, NEIGHBORHOODS } from "../data/neighborhoods.js";
import { haversineM, pointInGeometry } from "./geo.js";

export interface Route { id: string; name: string; short: string; color: string; textColor: string; type: number; stopIds: string[] }
export interface Station { id: string; name: string; lat: number; lon: number; municipality: string; wheelchair: boolean; routes: string[]; neighborhoodId: string | null }
export interface Shape { routeId: string; shapeId: string; coords: [number, number][] }

const read = (name: string) => JSON.parse(readFileSync(resolve(DATA_DIR, name), "utf8"));
const readIf = (name: string, fallback: any) => (existsSync(resolve(DATA_DIR, name)) ? read(name) : fallback);

const mbta = read("mbta.json");
const nbGeo = read("neighborhoods.geojson");

export const ROUTES: Route[] = mbta.routes;
export const SHAPES: Shape[] = mbta.shapes;
export const ROUTE_IDS = ROUTES.map((r) => r.id);
export const routeById = new Map(ROUTES.map((r) => [r.id, r]));

export const NB_FEATURES: { id: string; name: string; geometry: any }[] = nbGeo.features.map((f: any) => ({
  id: f.properties.id,
  name: f.properties.name,
  geometry: f.geometry,
}));

/** Neighborhood for a point: Boston polygons first, then the bonus area of the nearest station's city. */
export function neighborhoodAt(lat: number, lon: number, municipality?: string): string | null {
  for (const f of NB_FEATURES) if (pointInGeometry(lon, lat, f.geometry)) return f.id;
  if (municipality && BONUS_BY_MUNICIPALITY[municipality]) return BONUS_BY_MUNICIPALITY[municipality];
  return null;
}

export const STATIONS: Station[] = mbta.stations.map((s: any) => ({
  ...s,
  neighborhoodId: neighborhoodAt(s.lat, s.lon, s.municipality),
}));
export const stationById = new Map(STATIONS.map((s) => [s.id, s]));

export function nearestStations(lat: number, lon: number, limit = 3) {
  return STATIONS.map((s) => ({ station: s, distanceM: Math.round(haversineM(lat, lon, s.lat, s.lon)) }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

export function nearestSchool(lat: number, lon: number) {
  return SCHOOLS.map((s) => ({ school: s, distanceM: Math.round(haversineM(lat, lon, s.lat, s.lon)) })).sort(
    (a, b) => a.distanceM - b.distanceM,
  )[0];
}

/** "Away game": a station that's another target school's home station or within 900 m of its campus. */
export function awaySchoolFor(stationId: string, mySchoolId: string) {
  const st = stationById.get(stationId);
  if (!st) return null;
  return (
    SCHOOLS.find(
      (s) => s.id !== mySchoolId && (s.homeStations.includes(stationId) || haversineM(st.lat, st.lon, s.lat, s.lon) <= 900),
    ) || null
  );
}

export const SPOTS_FILE = read("spots.json");
export const PRICE_OVERRIDES: Record<string, { priceCents: number; cheapestItem?: string; checkedOn?: string }> = readIf(
  "price-overrides.json",
  {},
);

/** RentCast cache: { byZip: { "02115": { median: {studio, 1, 2, 3}, fetchedAt } }, stationZip: { "place-x": "02115" } } */
export function rentCache(): { byZip: Record<string, any>; stationZip: Record<string, string> } {
  return readIf("rent-cache.json", { byZip: {}, stationZip: {} });
}

export const NEIGHBORHOOD_META = new Map(NEIGHBORHOODS.map((n) => [n.id, n]));
export const BOSTON_NEIGHBORHOOD_COUNT = NEIGHBORHOODS.filter((n) => n.kind === "boston").length;
