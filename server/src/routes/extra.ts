/**
 * Sponsor-depth features:
 *  - Tiger Data: "best time to go" heatmap per spot from the spot_visits_hourly aggregate,
 *    and search by meaning with Gemini embeddings + pgvector in the same database
 *  - Gemini: menu photo → structured items and prices (fills OSM's missing prices)
 *  - GoDaddy domain: QR codes for partner counter posters
 *  - "How it's built": live proof of every sponsor integration
 */
import { Router } from "express";
import multer from "multer";
import QRCode from "qrcode";
import { config } from "../config.js";
import { getDb, type Db } from "../db/index.js";
import { requireUser } from "../auth.js";
import { EMBED_MODEL, embedTexts, geminiEnabled, readMenuAI } from "../lib/gemini.js";
import { solanaEnabled } from "../lib/external.js";
import { normalizePhoto } from "../lib/photo.js";
import { putObject, stats as storageStats, storageProvider } from "../lib/storage.js";
import { haversineM, walkMinutes } from "../lib/geo.js";
import { stationById } from "../lib/static.js";
import { HttpError, newId, rateLimit } from "../lib/util.js";
import { decorate } from "../services/spots.js";
import { live } from "../services/transit.js";
import { lastRuns } from "../services/workflow.js";

export const extraRoutes = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 } });

// ---- Tiger Data: best time to go --------------------------------------------------------
extraRoutes.get("/spots/:id/busy", async (req, res) => {
  const db = await getDb();
  const rows = await db.query(
    `SELECT extract(dow FROM bucket AT TIME ZONE 'America/New_York')::int AS dow,
            extract(hour FROM bucket AT TIME ZONE 'America/New_York')::int AS hour,
            sum(visits)::int AS visits
     FROM spot_visits_hourly WHERE spot_id=$1 AND bucket > now() - interval '56 days' GROUP BY 1, 2`,
    [req.params.id],
  );
  const total = rows.reduce((a: number, r: any) => a + r.visits, 0);
  const busiest = [...rows].sort((a: any, b: any) => b.visits - a.visits)[0] ?? null;
  res.json({ spotId: req.params.id, total, cells: rows, busiest, source: db.timescale ? "Tiger Data continuous aggregate spot_visits_hourly (8 weeks)" : "spot_visits_hourly view (8 weeks)" });
});

// ---- Gemini: menu photo → prices ------------------------------------------------------------
extraRoutes.post("/spots/:id/menu", requireUser, upload.single("photo"), async (req, res) => {
  if (!geminiEnabled()) throw new HttpError(503, "The menu reader needs GEMINI_API_KEY on the server.");
  if (!req.file) throw new HttpError(400, "Attach a photo of the menu");
  if (!rateLimit(`menu:${req.user.id}`, 10, 60 * 60_000)) throw new HttpError(429, "Too many menus this hour");
  const db = await getDb();
  const spot = await db.one("SELECT id, name FROM spots WHERE id=$1", [req.params.id]);
  if (!spot) throw new HttpError(404, "Spot not found");
  const photo = await normalizePhoto(req.file.buffer, 1800);
  const r = await readMenuAI(photo, spot.name);
  const items = (r.items || [])
    .filter((x) => x && typeof x.name === "string" && Number.isFinite(x.price) && x.price >= 0.5 && x.price <= 100)
    .slice(0, 40);
  if (!items.length) throw new HttpError(422, "Couldn't read any prices. Try a sharper, closer photo of the menu.");
  await db.query("DELETE FROM menu_items WHERE spot_id=$1", [spot.id]);
  for (const it of items) await db.query(`INSERT INTO menu_items (id, spot_id, user_id, name, price_cents) VALUES ($1,$2,$3,$4,$5)`, [newId("mi_"), spot.id, req.user.id, it.name.slice(0, 80), Math.round(it.price * 100)]);
  // cheapest real item (skip add-ons under $3) becomes the spot's price
  const meals = items.filter((x) => x.price >= 3).sort((a, b) => a.price - b.price);
  const cheapest = meals[0] ?? [...items].sort((a, b) => a.price - b.price)[0];
  await db.query(`UPDATE spots SET price_cents=$2, cheapest_item=$3, price_source='menu' WHERE id=$1`, [spot.id, Math.round(cheapest.price * 100), cheapest.name.slice(0, 80)]);
  putObject(`menus/${spot.id}/${Date.now()}.jpg`, photo, "image/jpeg", false).catch(() => {});
  res.json({ spot: spot.name, items, cheapest, confidence: r.confidence, readBy: `Gemini (${config.gemini.model})` });
});

extraRoutes.get("/spots/:id/menu", async (req, res) => {
  const db = await getDb();
  const items = await db.query(`SELECT name, price_cents, created_at FROM menu_items WHERE spot_id=$1 ORDER BY price_cents`, [req.params.id]);
  res.json({ items });
});

// ---- Tiger Data + Gemini: search by meaning -----------------------------------------------------
export async function semanticReady(db: Db) {
  if (!geminiEnabled()) return false;
  const n = await db.one(`SELECT count(*)::int AS n FROM spot_embeddings`).catch(() => null);
  return (n?.n ?? 0) > 0;
}

export async function semanticSearch(db: Db, q: string, lat: number, lon: number, radiusM: number, userId: string | null) {
  const [qv] = await embedTexts([q], "RETRIEVAL_QUERY");
  const dLat = radiusM / 111_000, dLon = radiusM / (111_000 * Math.cos((lat * Math.PI) / 180));
  let ranked: { id: string; sim: number }[];
  if (db.vector) {
    const rows = await db.query(
      `SELECT e.spot_id AS id, 1 - (e.embedding <=> $1::vector) AS sim FROM spot_embeddings e JOIN spots s ON s.id=e.spot_id
       WHERE s.lat BETWEEN $2 AND $3 AND s.lon BETWEEN $4 AND $5 ORDER BY e.embedding <=> $1::vector LIMIT 40`,
      [`[${qv.join(",")}]`, lat - dLat, lat + dLat, lon - dLon, lon + dLon],
    );
    ranked = rows.map((r: any) => ({ id: r.id, sim: Number(r.sim) }));
  } else {
    const rows = await db.query(
      `SELECT e.spot_id AS id, e.embedding FROM spot_embeddings e JOIN spots s ON s.id=e.spot_id WHERE s.lat BETWEEN $1 AND $2 AND s.lon BETWEEN $3 AND $4`,
      [lat - dLat, lat + dLat, lon - dLon, lon + dLon],
    );
    ranked = rows
      .map((r: any) => ({ id: r.id, sim: (r.embedding as number[]).reduce((a, x, i) => a + x * qv[i], 0) }))
      .sort((a: any, b: any) => b.sim - a.sim)
      .slice(0, 40);
  }
  if (!ranked.length) return [];
  const spots = await db.query(
    `SELECT s.*, NULL AS partner_id, false AS visited FROM spots s WHERE s.id = ANY($1)`,
    [ranked.map((r) => r.id)],
  );
  const by = new Map(spots.map((s: any) => [s.id, s]));
  return ranked
    .map((r) => {
      const s: any = by.get(r.id);
      if (!s) return null;
      const d = decorate(s);
      const dist = haversineM(lat, lon, s.lat, s.lon);
      return { ...d, similarity: Math.round(r.sim * 1000) / 1000, distanceM: Math.round(dist), walkMin: walkMinutes(dist), station: stationById.get(s.station_id)?.name ?? null };
    })
    .filter(Boolean) as any[];
}

// ---- QR codes for counter posters (domain) ---------------------------------------------------------
extraRoutes.get("/qr.svg", async (req, res) => {
  const text = String(req.query.text || config.publicUrl).slice(0, 300);
  res.type("image/svg+xml").send(await QRCode.toString(text, { type: "svg", margin: 1, color: { dark: "#0d0e12", light: "#ffffff" } }));
});

// ---- How it's built: live proof of each sponsor integration -------------------------------------
extraRoutes.get("/proof", async (_req, res) => {
  const db = await getDb();
  const count = async (t: string, where = "") => (await db.one(`SELECT count(*)::int AS n FROM ${t} ${where}`).catch(() => ({ n: null })))?.n ?? null;
  const [checkins, positions, predictions, metrics, embeddings, menus, redemptions, receipts, lastMetric] = await Promise.all([
    count("checkins"), count("train_positions"), count("train_predictions"), count("line_metrics"), count("spot_embeddings"),
    count("menu_items"), count("redemptions", "WHERE redeemed_at IS NOT NULL"), count("redemptions", "WHERE solana_sig IS NOT NULL"),
    db.one(`SELECT max(ts) AS ts FROM line_metrics`).catch(() => null),
  ]);
  const recentSigs = await db.query(`SELECT solana_sig, redeemed_at FROM redemptions WHERE solana_sig IS NOT NULL ORDER BY redeemed_at DESC LIMIT 3`).catch(() => []);
  res.json({
    database: {
      engine: db.timescale ? "Tiger Data (TimescaleDB)" : db.kind === "postgres" ? "Postgres" : "Embedded PGlite (dev)",
      hypertables: db.timescale ? ["checkins", "train_positions", "train_predictions", "line_metrics"] : [],
      continuousAggregates: db.caggs ?? [],
      pgvector: !!db.vector,
      rows: { checkins, train_positions: positions, train_predictions: predictions, line_metrics: metrics, spot_embeddings: embeddings, menu_items: menus },
      lastLineMetric: lastMetric?.ts ?? null,
    },
    gemini: { enabled: geminiEnabled(), model: geminiEnabled() ? config.gemini.model : null, embedModel: EMBED_MODEL, uses: ["photo check-in", "menu reader", "listing scam scan", "search by meaning", "workflow understand/write", "translation", "tip screening"] },
    mastra: { lastRuns: lastRuns.slice(0, 2) },
    mbta: { vehicles: live.vehicles.length, vehiclesAt: live.vehiclesAt, alerts: live.alerts.length, lastError: live.lastError },
    storage: { provider: storageProvider(), ...storageStats },
    solana: { enabled: solanaEnabled(), redemptions, receipts, recent: recentSigs.map((r: any) => ({ sig: r.solana_sig, url: `https://explorer.solana.com/tx/${r.solana_sig}?cluster=devnet` })) },
    domain: config.publicUrl,
  });
});
