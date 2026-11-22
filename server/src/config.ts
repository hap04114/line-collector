import "dotenv/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// All "local time" logic (open now, finals-week nights, weekly resets) is Boston time.
process.env.TZ = "America/New_York";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA_DIR = resolve(ROOT, "data");
export const STATE_DIR = resolve(ROOT, process.env.STATE_DIR || ".data");

const bool = (v: string | undefined, d = false) => (v == null || v === "" ? d : /^(1|true|yes|on)$/i.test(v));
const num = (v: string | undefined, d: number) => (v == null || v === "" ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 8787),
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${num(process.env.PORT, 8787)}`).replace(/\/$/, ""),
  isProd: process.env.NODE_ENV === "production",
  sessionSecret: process.env.SESSION_SECRET || "dev-only-secret-change-me",

  /** Postgres / Tiger Cloud. Empty → embedded PGlite in .data/pglite */
  databaseUrl: process.env.DATABASE_URL || "",

  /** Demo affordances for judging: one-tap demo sign-in, simulated location at a spot. */
  demoMode: bool(process.env.DEMO_MODE, true),
  /** Show sign-in links on screen instead of emailing them (no email provider configured). */
  devShowMagicLink: bool(process.env.DEV_SHOW_MAGIC_LINK, !process.env.RESEND_API_KEY),

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
    fallbacks: (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.1-flash-lite,gemini-flash-lite-latest").split(",").map((m) => m.trim()).filter(Boolean),
    timeoutMs: num(process.env.GEMINI_TIMEOUT_MS, 12000),
  },
  mbta: {
    apiKey: process.env.MBTA_API_KEY || "",
    pollerEnabled: bool(process.env.POLLER_ENABLED, true),
    vehiclesEveryMs: num(process.env.POLL_VEHICLES_MS, process.env.MBTA_API_KEY ? 10_000 : 15_000),
    metricsEveryMs: num(process.env.POLL_METRICS_MS, 30_000),
    alertsEveryMs: num(process.env.POLL_ALERTS_MS, 120_000),
  },
  email: {
    resendKey: process.env.RESEND_API_KEY || "",
    from: process.env.EMAIL_FROM || "Charlie on the MTA <onboarding@resend.dev>",
  },
  rentcastKey: process.env.RENTCAST_API_KEY || "",
  // Google Map Tiles API (Photorealistic 3D Tiles) for Street Runner; a browser key, restrict it by website
  googleTilesKey: process.env.GOOGLE_MAPS_API_KEY || "",
  solana: {
    secretKey: process.env.SOLANA_SECRET_KEY || "",
    rpc: process.env.SOLANA_RPC || "https://api.devnet.solana.com",
  },
  /** US Census geocoder: free, no key; used for sublet addresses and ZIP lookup. */
  geocoderUrl: process.env.GEOCODER_URL || "https://geocoding.geo.census.gov/geocoder",

  game: {
    checkinRadiusM: 150,
    landmarkRadiusM: 400,
    dailyCap: 5,
    multiplierCap: 4,
    friendWindowMin: 10,
    defaultBudgetCents: 1000,
    defaultBaselineCents: 1500,
  },
};

export type Config = typeof config;
