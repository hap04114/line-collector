/**
 * Travel time by mode, with near / medium / far bands and directions (T-Field shared/modes.json presets).
 * With GOOGLE_API_KEY: Google Routes API (walk, transit incl. bus/commuter rail, bike, drive) with step-by-step directions.
 * Without it: T-Field's own estimates (walk 1.3 m/s × 1.25 detour, half-headway wait, 2 min per transfer,
 * 2 min per bike dock, 6 min rideshare pickup) on our station list.
 */
import { haversineM } from "../lib/geo.js";
import { nearestStations, routeById } from "../lib/static.js";
import { nearestDocks, type Dock } from "./bluebikes.js";

export type Preset = "walk" | "t" | "t_bus" | "bike" | "rideshare";
export const PRESETS: Record<Preset, { label: string; bands: { near: number; medium: number; far: number } }> = {
  walk: { label: "Walk", bands: { near: 10, medium: 20, far: 35 } },
  t: { label: "T + walk", bands: { near: 15, medium: 30, far: 50 } },
  t_bus: { label: "T + bus + walk", bands: { near: 15, medium: 30, far: 50 } },
  bike: { label: "Blue Bikes", bands: { near: 10, medium: 20, far: 35 } },
  rideshare: { label: "Rideshare (estimate)", bands: { near: 10, medium: 20, far: 30 } },
};
export const SPEED = { walk: 1.3, walkAccessible: 0.9, bike: 4.2, min: 0.6, max: 1.6 };
const DETOUR = 1.25, HALF_HEADWAY_MIN = 4, TRANSFER_MIN = 2, DOCK_MIN = 2, PICKUP_MIN = 6;
const RIDE_M_PER_MIN = 500, CAR_M_PER_MIN = 350, GOOGLE_WALK_MPS = 1.35;

export type Band = "near" | "medium" | "far" | null;
export function bandOf(min: number, preset: Preset): Band {
  const t = PRESETS[preset].bands;
  return min <= t.near ? "near" : min <= t.medium ? "medium" : min <= t.far ? "far" : null;
}

export interface Step { mode: "walk" | "transit" | "bike" | "drive"; text: string; minutes: number; distanceM?: number; line?: { name: string; color: string | null }; from?: string; to?: string; stops?: number }
export interface Option { preset: Preset; label: string; minutes: number; band: Band; distanceM: number; steps: Step[]; source: "google" | "estimate"; note?: string }
interface P { lat: number; lon: number }

const walkMin = (m: number, speed: number) => Math.max(1, Math.round((m * DETOUR) / speed / 60));

// ---- estimates (no key) ----------------------------------------------------------------------------
export function estimate(preset: Preset, a: P, b: P, speed: number, docks: Dock[] = []): Option {
  const d = haversineM(a.lat, a.lon, b.lat, b.lon);
  const done = (minutes: number, steps: Step[], note?: string): Option => ({ preset, label: PRESETS[preset].label, minutes, band: bandOf(minutes, preset), distanceM: Math.round(d * DETOUR), steps, source: "estimate", note });
  if (preset === "walk") return done(walkMin(d, speed), [{ mode: "walk", text: "Walk to the destination", minutes: walkMin(d, speed), distanceM: Math.round(d * DETOUR) }]);
  if (preset === "rideshare") { const m = Math.round((d * 1.4) / CAR_M_PER_MIN) + PICKUP_MIN; return done(m, [{ mode: "drive", text: `About ${PICKUP_MIN} min for a pickup, then drive`, minutes: m }], "Price and wait vary; this is a rough estimate"); }
  if (preset === "bike") {
    const from = nearestDocks(docks, a.lat, a.lon, "bike", 1)[0], to = nearestDocks(docks, b.lat, b.lon, "dock", 1)[0];
    if (!from || !to) { const m = Math.round((d * DETOUR) / SPEED.bike / 60) + 2 * DOCK_MIN; return done(m, [{ mode: "bike", text: "Ride a Blue Bike", minutes: m }], docks.length ? "No dock with bikes close by" : "Live dock data unavailable"); }
    const w1 = walkMin(from.distanceM, speed), w2 = walkMin(to.distanceM, speed);
    const ride = Math.round((haversineM(from.lat, from.lon, to.lat, to.lon) * DETOUR) / SPEED.bike / 60);
    return done(w1 + DOCK_MIN + ride + DOCK_MIN + w2, [
      { mode: "walk", text: `Walk to ${from.name} (${from.bikes} bikes now)`, minutes: w1, distanceM: from.distanceM },
      { mode: "bike", text: `Ride to ${to.name} (${to.docks} open docks now)`, minutes: ride + 2 * DOCK_MIN },
      { mode: "walk", text: "Walk to the destination", minutes: w2, distanceM: to.distanceM },
    ]);
  }
  // T (and T + bus, which we can only estimate on the T without Google)
  const so = nearestStations(a.lat, a.lon, 1)[0], sd = nearestStations(b.lat, b.lon, 1)[0];
  const walkAll = walkMin(d, speed);
  if (!so || !sd || so.station.id === sd.station.id) return done(walkAll, [{ mode: "walk", text: "Walk: the T doesn't save time here", minutes: walkAll }]);
  const shared = so.station.routes.filter((r) => sd.station.routes.includes(r));
  const lines = (shared.length ? shared.slice(0, 1) : [so.station.routes[0], sd.station.routes[0]]).map((r) => routeById.get(r)).filter(Boolean);
  const w1 = walkMin(so.distanceM, speed), w2 = walkMin(sd.distanceM, speed);
  const ride = Math.max(2, Math.round((haversineM(so.station.lat, so.station.lon, sd.station.lat, sd.station.lon) * 1.3) / RIDE_M_PER_MIN));
  const transfers = shared.length ? 0 : 1;
  const total = w1 + HALF_HEADWAY_MIN + ride + transfers * (TRANSFER_MIN + HALF_HEADWAY_MIN) + w2;
  if (total >= walkAll) return done(walkAll, [{ mode: "walk", text: "Walk: faster than waiting for the T", minutes: walkAll }]);
  return done(total, [
    { mode: "walk", text: `Walk to ${so.station.name}`, minutes: w1, distanceM: so.distanceM },
    { mode: "transit", text: transfers ? `Ride, with one transfer, to ${sd.station.name}` : `Ride to ${sd.station.name}`, minutes: ride + HALF_HEADWAY_MIN + transfers * (TRANSFER_MIN + HALF_HEADWAY_MIN), line: lines[0] ? { name: lines.map((l) => l!.short).join(" → "), color: lines[0]!.color } : undefined, from: so.station.name, to: sd.station.name },
    { mode: "walk", text: "Walk to the destination", minutes: w2, distanceM: sd.distanceM },
  ], preset === "t_bus" ? "Buses need Google directions; this estimate uses the T only" : undefined);
}

// ---- Google Routes API ---------------------------------------------------------------------------
export const googleKey = () => process.env.GOOGLE_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "";
const secs = (s?: string) => (s ? Number(String(s).replace("s", "")) || 0 : 0);
const FIELDS = [
  "routes.duration", "routes.distanceMeters", "routes.legs.steps.travelMode", "routes.legs.steps.staticDuration", "routes.legs.steps.distanceMeters",
  "routes.legs.steps.navigationInstruction.instructions", "routes.legs.steps.transitDetails.transitLine.nameShort", "routes.legs.steps.transitDetails.transitLine.name",
  "routes.legs.steps.transitDetails.transitLine.color", "routes.legs.steps.transitDetails.stopDetails.departureStop.name",
  "routes.legs.steps.transitDetails.stopDetails.arrivalStop.name", "routes.legs.steps.transitDetails.stopCount", "routes.legs.steps.transitDetails.headsign",
].join(",");

/** Turns a Routes API response into our steps, folding runs of walking steps into one. Pure, so it's tested. */
export function shapeGoogle(json: any, preset: Preset, speed: number): Option | null {
  const r = json?.routes?.[0];
  if (!r) return null;
  const raw: any[] = (r.legs ?? []).flatMap((l: any) => l.steps ?? []);
  const slow = GOOGLE_WALK_MPS / speed;
  const steps: Step[] = [];
  let extra = 0;
  for (const s of raw) {
    const mode: Step["mode"] = s.travelMode === "TRANSIT" ? "transit" : s.travelMode === "BICYCLE" ? "bike" : s.travelMode === "DRIVE" ? "drive" : "walk";
    let min = secs(s.staticDuration) / 60;
    if (mode === "walk") { extra += min * (slow - 1); min *= slow; }
    const prev = steps[steps.length - 1];
    if (mode === "walk" && prev?.mode === "walk") { prev.minutes += min; prev.distanceM = (prev.distanceM ?? 0) + (s.distanceMeters ?? 0); continue; }
    const td = s.transitDetails;
    steps.push(td ? {
      mode, minutes: min, distanceM: s.distanceMeters,
      text: `${td.transitLine?.nameShort || td.transitLine?.name || "Transit"}${td.headsign ? ` toward ${td.headsign}` : ""}`,
      line: { name: td.transitLine?.nameShort || td.transitLine?.name || "Transit", color: td.transitLine?.color ?? null },
      from: td.stopDetails?.departureStop?.name, to: td.stopDetails?.arrivalStop?.name, stops: td.stopCount,
    } : { mode, minutes: min, distanceM: s.distanceMeters, text: s.navigationInstruction?.instructions || (mode === "walk" ? "Walk" : mode === "bike" ? "Ride" : "Drive") });
  }
  for (const s of steps) s.minutes = Math.max(1, Math.round(s.minutes));
  let minutes = Math.round(secs(r.duration) / 60 + (preset === "walk" ? (secs(r.duration) / 60) * (slow - 1) : extra));
  if (preset === "rideshare") minutes += PICKUP_MIN;
  return { preset, label: PRESETS[preset].label, minutes: Math.max(1, minutes), band: bandOf(minutes, preset), distanceM: r.distanceMeters ?? 0, steps: steps.slice(0, 30), source: "google" };
}

export async function google(preset: Preset, a: P, b: P, speed: number, accessible: boolean): Promise<Option | null> {
  const key = googleKey();
  if (!key) return null;
  const mode = preset === "walk" ? "WALK" : preset === "bike" ? "BICYCLE" : preset === "rideshare" ? "DRIVE" : "TRANSIT";
  const body: any = {
    origin: { location: { latLng: { latitude: a.lat, longitude: a.lon } } },
    destination: { location: { latLng: { latitude: b.lat, longitude: b.lon } } },
    travelMode: mode, languageCode: "en-US", units: "IMPERIAL",
  };
  if (mode === "TRANSIT") body.transitPreferences = { allowedTravelModes: preset === "t_bus" ? ["SUBWAY", "LIGHT_RAIL", "TRAIN", "BUS"] : ["SUBWAY", "LIGHT_RAIL", "TRAIN"], ...(accessible ? { routingPreference: "LESS_WALKING" } : {}) };
  if (mode === "DRIVE") body.routingPreference = "TRAFFIC_AWARE";
  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS },
    body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Routes API ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const opt = shapeGoogle(await res.json(), preset, speed);
  if (opt && accessible && (preset === "walk" || preset === "bike")) opt.note = "Google can't avoid steps on walking routes; check the route if you need step-free access";
  return opt;
}
