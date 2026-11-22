/**
 * T-Field endpoints:
 *   GET /api/tfield/meta                       allergen list, venue types, disclaimer, whether Google is on
 *   GET /api/travel?lat&lon&toLat&toLon&speed&accessible&modes=walk,t,t_bus,bike,rideshare
 *   GET /api/bluebikes/near?lat&lon&need=bike|dock
 */
import { Router } from "express";
import { z } from "zod";
import { HttpError, rateLimit } from "../lib/util.js";
import { getDocks, nearestDocks } from "../services/bluebikes.js";
import { ALLERGEN_DISCLAIMER, ALLERGENS, ALLERGEN_UMBRELLA, VENUE_TYPES } from "../services/tfield.js";
import { estimate, google, googleKey, PRESETS, SPEED, type Option, type Preset } from "../services/travel.js";

export const tfieldRoutes = Router();

tfieldRoutes.get("/tfield/meta", (_req, res) => {
  res.json({
    allergens: [...ALLERGENS, ...Object.keys(ALLERGEN_UMBRELLA)],
    venueTypes: Object.entries(VENUE_TYPES).map(([id, label]) => ({ id, label })),
    disclaimer: ALLERGEN_DISCLAIMER,
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, ...p })),
    speed: SPEED,
    google: !!googleKey(),
  });
});

const TQ = z.object({
  lat: z.coerce.number().min(41).max(43.5), lon: z.coerce.number().min(-72.5).max(-70),
  toLat: z.coerce.number().min(41).max(43.5), toLon: z.coerce.number().min(-72.5).max(-70),
  speed: z.coerce.number().min(SPEED.min).max(SPEED.max).default(SPEED.walk),
  accessible: z.enum(["1", "0", "true", "false"]).optional().transform((v) => v === "1" || v === "true"),
  modes: z.string().max(60).optional(),
});
const travelCache = new Map<string, { at: number; value: unknown }>();

tfieldRoutes.get("/travel", async (req, res) => {
  const q = TQ.parse(req.query);
  const modes = (q.modes ? q.modes.split(",") : Object.keys(PRESETS)).filter((m): m is Preset => m in PRESETS);
  const r4 = (n: number) => n.toFixed(4);
  const key = `${r4(q.lat)},${r4(q.lon)}>${r4(q.toLat)},${r4(q.toLon)}|${q.speed}|${q.accessible}|${modes.join(",")}`;
  const hit = travelCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return res.json(hit.value);
  const useGoogle = !!googleKey();
  if (useGoogle && !rateLimit(`travel:${(req as any).user?.id ?? req.ip}`, 40, 10 * 60_000)) throw new HttpError(429, "Too many direction requests. Try again in a few minutes.");
  const a = { lat: q.lat, lon: q.lon }, b = { lat: q.toLat, lon: q.toLon };
  const docks = modes.includes("bike") ? await getDocks().catch(() => []) : [];
  const options: Option[] = await Promise.all(modes.map(async (m) => {
    if (useGoogle) {
      try { const g = await google(m, a, b, q.speed, !!q.accessible); if (g) return g; }
      catch (e) { console.warn(`[travel] ${m}:`, (e as Error).message); }
    }
    return estimate(m, a, b, q.speed, docks);
  }));
  const value = { source: options.some((o) => o.source === "google") ? "google" : "estimate", speed: q.speed, accessible: !!q.accessible, options };
  if (travelCache.size > 500) travelCache.delete(travelCache.keys().next().value!);
  travelCache.set(key, { at: Date.now(), value });
  res.json(value);
});

tfieldRoutes.get("/bluebikes/near", async (req, res) => {
  const q = z.object({ lat: z.coerce.number(), lon: z.coerce.number(), need: z.enum(["bike", "dock", "any"]).default("any") }).parse(req.query);
  try {
    const docks = await getDocks();
    res.json({ docks: nearestDocks(docks, q.lat, q.lon, q.need, 3, 800) });
  } catch {
    throw new HttpError(503, "Blue Bikes live data isn't answering right now");
  }
});
