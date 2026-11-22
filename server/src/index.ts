import { config, ROOT } from "./config.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { ZodError } from "zod";
import { getDb } from "./db/index.js";
import { migrate } from "./db/schema.js";
import { seedDemo, seedStatic } from "./db/seed.js";
import { loadSession } from "./auth.js";
import { HttpError } from "./lib/util.js";
import { startPoller } from "./services/transit.js";
import { authRoutes } from "./routes/auth.js";
import { gameRoutes } from "./routes/game.js";
import { communityRoutes } from "./routes/community.js";
import { liveRoutes, UPLOAD_DIR } from "./routes/live.js";
import { rideRoutes } from "./routes/ride.js";
import { aiRoutes } from "./routes/ai.js";
import { arcadeRoutes } from "./routes/arcade.js";
import { extraRoutes } from "./routes/extra.js";
import { freeBostonRoutes } from "./routes/freeBoston.js";
import { tfieldRoutes } from "./routes/tfield.js";
import { housingRoutes } from "./routes/housing.js";
import { scheduleBackups } from "./lib/storage.js";
import { applyTField } from "./services/tfield.js";

async function main() {
  const db = await getDb();
  await migrate(db);
  await seedStatic(db);
  await applyTField(db);

  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    next();
  });

  // CORS only for the Chrome extension's read-only status calls
  app.use("/api/lines/status", (req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    next();
  });
  app.get("/api/health", async (_req, res) => res.json({ ok: true, db: db.kind, timescale: db.timescale, caggs: db.caggs ?? [] }));

  const api = express.Router();
  api.use(loadSession);
  api.use(authRoutes, gameRoutes, communityRoutes, liveRoutes, rideRoutes, aiRoutes, arcadeRoutes, extraRoutes, freeBostonRoutes, tfieldRoutes, housingRoutes);
  app.use("/api", api);
  app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d", fallthrough: false }));

  const dist = resolve(ROOT, "web/dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { maxAge: "1h", index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(dist, "index.html")));
  } else {
    app.get("/", (_req, res) => res.type("text").send("API running. Start the web app with `npm run dev` (Vite on :5173) or build it with `npm run build`."));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, data: err.data });
    if (err instanceof ZodError) return res.status(400).json({ error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    if ((err as any)?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Photo too large (12 MB max)" });
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  });

  app.listen(config.port, () => {
    console.log(`[server] Charlie on the MTA on ${config.publicUrl} (port ${config.port})${config.demoMode ? " · DEMO_MODE on" : ""}`);
  });

  await startPoller(db);
  scheduleBackups(db);
  if (config.demoMode) seedDemo(db).catch((e) => console.error("[seed] demo seeding failed", e));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
