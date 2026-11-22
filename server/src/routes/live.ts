/**
 * Live: scout where to live next year.
 *  - listing check for any pasted listing or screenshot
 *  - verified student sublets with automatic checks before they go live
 *  - neighborhood rent snapshot from cached RentCast data
 * The app links only to original listings and moves no money.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { STATE_DIR } from "../config.js";
import { getDb } from "../db/index.js";
import { requireUser } from "../auth.js";
import { schoolById } from "../data/schools.js";
import { geocodeAddress } from "../lib/external.js";
import { haversineM, walkMinutes } from "../lib/geo.js";
import { dHash, hamming, NEAR_DUPLICATE_BITS, normalizePhoto } from "../lib/photo.js";
import { nearestStations, rentCache, stationById } from "../lib/static.js";
import { HttpError, firstName, newId, rateLimit } from "../lib/util.js";
import { checkListing, typicalRent } from "../services/listing.js";
import { putObject } from "../lib/storage.js";

export const liveRoutes = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 5 } });
export const UPLOAD_DIR = resolve(STATE_DIR, "uploads");
mkdirSync(resolve(UPLOAD_DIR, "sublets"), { recursive: true });

liveRoutes.post("/listing-check", upload.single("screenshot"), async (req, res) => {
  const text = String(req.body?.text || "").slice(0, 8000);
  if (!text.trim() && !req.file) throw new HttpError(400, "Paste a listing or attach a screenshot");
  if (!rateLimit(`listing:${req.user?.id ?? req.ip}`, 20, 10 * 60_000)) throw new HttpError(429, "Too many checks; try again shortly");
  const image = req.file ? { mime: "image/jpeg", data: await normalizePhoto(req.file.buffer, 1600) } : undefined;
  const result = await checkListing(text || "(screenshot only)", image);
  if (req.user) await (await getDb()).query("UPDATE users SET rights_checked=true WHERE id=$1", [req.user.id]);
  res.json(result);
});

liveRoutes.get("/rent", (req, res) => {
  const stop = String(req.query.stop || "");
  const cache = rentCache();
  const zip = cache.stationZip[stop] ?? null;
  const z0 = zip ? cache.byZip[zip] : null;
  res.json({ stationId: stop, zip, rent: z0 ?? null, source: z0 ? "RentCast (cached)" : null });
});

// ---- sublets ----------------------------------------------------------------------------------
/** Commute estimate: walk to nearest station, ride to the school's home station, 5 min wait. */
function commuteMin(fromStation: string, schoolId: string) {
  const sc = schoolById(schoolId);
  const a = stationById.get(fromStation);
  if (!sc || !a) return null;
  const best = sc.homeStations
    .map((id) => stationById.get(id)!)
    .map((b) => Math.round(haversineM(a.lat, a.lon, b.lat, b.lon) / 400) + (a.id === b.id ? 0 : 5))
    .sort((x, y) => x - y)[0];
  return best;
}

liveRoutes.post("/sublets", requireUser, upload.array("photos", 5), async (req, res) => {
  if (!rateLimit(`sublet:${req.user.id}`, 5, 24 * 3600_000)) throw new HttpError(429, "Posting limit reached for today");
  const b = z
    .object({
      title: z.string().trim().min(5).max(90),
      address: z.string().trim().min(5).max(160),
      zip: z.string().regex(/^\d{5}$/).optional().or(z.literal("")),
      lat: z.coerce.number().optional(),
      lon: z.coerce.number().optional(),
      startDate: z.string(),
      endDate: z.string(),
      price: z.coerce.number().min(100).max(20000),
      bedrooms: z.coerce.number().int().min(0).max(6).optional(),
      description: z.string().trim().max(3000).default(""),
      contact: z.string().trim().min(3).max(120),
      landlordConsent: z.string(),
    })
    .parse(req.body);
  if (b.landlordConsent !== "true") throw new HttpError(400, "Confirm your landlord allows subletting. Many Boston leases require written consent.");

  const flags: any[] = [];
  // 1. the address must exist; it's placed on the map with its nearest station and commute time
  const geo = await geocodeAddress(`${b.address}, ${b.zip || "Boston, MA"}`);
  const lat = geo?.lat ?? b.lat, lon = geo?.lon ?? b.lon;
  if (lat == null || lon == null) throw new HttpError(422, "We couldn't find that address. Check it, or drop a pin on the map.");
  if (!geo) flags.push({ type: "address", severity: "low", quote: b.address, explanation: "Address not matched by the geocoder; location comes from the map pin." });
  const near = nearestStations(lat, lon, 1)[0];
  if (near.distanceM > 5000) throw new HttpError(422, "That address is too far from the T for Line Collector.");
  const zip = geo?.zip || b.zip || rentCache().stationZip[near.station.id] || null;

  // 2. price vs the neighborhood's typical rent ("too good to be true" under 60%)
  const typical = typicalRent(zip, b.bedrooms ?? null);
  let priceNormal: boolean | null = null;
  if (typical) {
    priceNormal = b.price >= typical.median * 0.6;
    if (!priceNormal)
      flags.push({ type: "price", severity: "high", quote: `$${b.price}/mo`, explanation: `Under 60% of the typical $${Math.round(typical.median)} for ${zip}. Too good to be true.` });
  }

  // 3. scan the text for scam signs (rules + Gemini)
  const scan = await checkListing(`${b.title}\n${b.description}\n$${b.price}/mo`);
  for (const f of scan.flags) if (f.type !== "price") flags.push(f);

  // 4. photos: compare fingerprints with every earlier listing; reused photos are blocked
  const files = (req.files as Express.Multer.File[]) || [];
  const earlier = (await (await getDb()).query<{ h: string }>("SELECT unnest(photo_hashes) AS h FROM sublets")).map((r) => r.h);
  const photos: string[] = [];
  const hashes: string[] = [];
  const id = newId("sl_");
  for (const [i, f] of files.entries()) {
    const img = await normalizePhoto(f.buffer, 1400);
    const h = await dHash(img);
    if (earlier.some((e) => hamming(e, h) <= NEAR_DUPLICATE_BITS)) {
      throw new HttpError(422, `Photo ${i + 1} matches a photo from an earlier listing. Reused photos are blocked.`);
    }
    photos.push(await putObject(`sublets/${id}-${i}.jpg`, img, "image/jpeg", true));
    hashes.push(h);
  }

  const high = flags.some((f) => f.severity === "high");
  const school = schoolById(req.user.school_id)!;
  const badges = [`Verified ${school.short} student`];
  if (priceNormal) badges.push("Price normal for the area");
  if (!flags.some((f) => f.severity !== "low")) badges.push("No red flags found");
  const status = high ? "flagged" : "live";

  const db = await getDb();
  await db.query(
    `INSERT INTO sublets (id, user_id, school_id, title, address, zip, lat, lon, station_id, walk_min, commute_min, start_date, end_date,
       price_cents, bedrooms, description, photos, photo_hashes, landlord_consent, contact, flags, badges, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,true,$19,$20,$21,$22)`,
    [
      id, req.user.id, req.user.school_id, b.title, geo?.matched ?? b.address, zip, lat, lon, near.station.id, walkMinutes(near.distanceM),
      commuteMin(near.station.id, req.user.school_id), b.startDate, b.endDate, Math.round(b.price * 100), b.bedrooms ?? null, b.description,
      photos, hashes, b.contact, JSON.stringify(flags), badges, status,
    ],
  );
  res.json({ id, status, flags, badges, station: near.station.name });
});

function publicSublet(s: any, me: string | null, accepted: boolean) {
  return {
    id: s.id, title: s.title, school: schoolById(s.school_id)?.short, schoolId: s.school_id,
    // exact address and contact are shared only after both sides accept
    area: stationById.get(s.station_id)?.name, address: accepted || s.user_id === me ? s.address : null,
    lat: accepted || s.user_id === me ? s.lat : +(+s.lat).toFixed(3), lon: accepted || s.user_id === me ? s.lon : +(+s.lon).toFixed(3),
    stationId: s.station_id, walkMin: s.walk_min, commuteMin: s.commute_min, startDate: s.start_date, endDate: s.end_date,
    price: s.price_cents / 100, bedrooms: s.bedrooms, description: s.description, photos: s.photos, badges: s.badges, flags: s.flags,
    status: s.status, mine: s.user_id === me, contact: accepted || s.user_id === me ? s.contact : null, poster: firstName(s.display_name ?? ""),
  };
}

liveRoutes.get("/sublets", requireUser, async (req, res) => {
  const db = await getDb();
  const rows = await db.query(
    `SELECT s.*, u.display_name,
       EXISTS (SELECT 1 FROM sublet_requests r WHERE r.sublet_id=s.id AND r.user_id=$1 AND r.status='accepted') AS accepted,
       (SELECT status FROM sublet_requests r WHERE r.sublet_id=s.id AND r.user_id=$1) AS my_request
     FROM sublets s JOIN users u ON u.id=s.user_id
     WHERE s.status='live' AND s.end_date >= current_date
       AND s.user_id NOT IN (SELECT blocked_id FROM blocks WHERE user_id=$1)
     ORDER BY (s.school_id = $2) DESC, s.created_at DESC LIMIT 40`,
    [req.user.id, req.user.school_id],
  );
  res.json({ sublets: rows.map((r: any) => ({ ...publicSublet(r, req.user.id, r.accepted), myRequest: r.my_request })) });
});

liveRoutes.get("/sublets/mine", requireUser, async (req, res) => {
  const db = await getDb();
  const posts = await db.query(`SELECT s.*, u.display_name FROM sublets s JOIN users u ON u.id=s.user_id WHERE s.user_id=$1 ORDER BY s.created_at DESC`, [req.user.id]);
  const incoming = await db.query(
    `SELECT r.*, u.display_name, u.school_id FROM sublet_requests r JOIN sublets s ON s.id=r.sublet_id JOIN users u ON u.id=r.user_id
     WHERE s.user_id=$1 ORDER BY r.created_at DESC`,
    [req.user.id],
  );
  const outgoing = await db.query(
    `SELECT r.*, s.title, s.contact AS poster_contact FROM sublet_requests r JOIN sublets s ON s.id=r.sublet_id WHERE r.user_id=$1 ORDER BY r.created_at DESC`,
    [req.user.id],
  );
  res.json({
    posts: posts.map((p: any) => publicSublet(p, req.user.id, true)),
    incoming: incoming.map((r: any) => ({ id: r.id, subletId: r.sublet_id, from: firstName(r.display_name), school: schoolById(r.school_id)?.short, message: r.message, status: r.status, contact: r.status === "accepted" ? r.contact : null })),
    outgoing: outgoing.map((r: any) => ({ id: r.id, subletId: r.sublet_id, title: r.title, status: r.status, contact: r.status === "accepted" ? r.poster_contact : null })),
  });
});

liveRoutes.post("/sublets/:id/request", requireUser, async (req, res) => {
  const b = z.object({ message: z.string().max(400).default(""), contact: z.string().trim().min(3).max(120) }).parse(req.body);
  const db = await getDb();
  const s = await db.one("SELECT * FROM sublets WHERE id=$1 AND status='live'", [req.params.id]);
  if (!s) throw new HttpError(404, "Listing not found");
  if (s.user_id === req.user.id) throw new HttpError(400, "That's your listing");
  await db.query(
    `INSERT INTO sublet_requests (id, sublet_id, user_id, message, contact) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (sublet_id, user_id) DO NOTHING`,
    [newId("sr_"), s.id, req.user.id, b.message, b.contact],
  );
  res.json({ ok: true });
});

liveRoutes.post("/sublet-requests/:id/:action", requireUser, async (req, res) => {
  const action = String(req.params.action);
  if (!["accept", "decline"].includes(action)) throw new HttpError(404, "Unknown action");
  const db = await getDb();
  const r = await db.one(`SELECT r.* FROM sublet_requests r JOIN sublets s ON s.id=r.sublet_id WHERE r.id=$1 AND s.user_id=$2`, [req.params.id, req.user.id]);
  if (!r) throw new HttpError(404, "Request not found");
  await db.query("UPDATE sublet_requests SET status=$2 WHERE id=$1", [r.id, action === "accept" ? "accepted" : "declined"]);
  res.json({ ok: true });
});

liveRoutes.post("/sublets/:id/report", requireUser, async (req, res) => {
  const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
  const db = await getDb();
  await db.query("INSERT INTO sublet_reports (sublet_id, user_id, reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [req.params.id, req.user.id, reason ?? null]);
  await db.query("UPDATE sublets SET status='hidden' WHERE id=$1", [req.params.id]); // one report hides it until reviewed
  res.json({ ok: true, hidden: true });
});
