import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { getDb } from "../db/index.js";
import { DEMO_PERSONAS } from "../db/seed.js";
import { createSession, destroySession, issueLoginToken } from "../auth.js";
import { SCHOOLS, schoolForEmail } from "../data/schools.js";
import { sendEmail } from "../lib/external.js";
import { geminiEnabled } from "../lib/gemini.js";
import { solanaEnabled } from "../lib/external.js";
import { friendCode, HttpError, newId, rateLimit, sha256 } from "../lib/util.js";

export const authRoutes = Router();

authRoutes.get("/config", async (_req, res) => {
  const db = await getDb();
  res.json({
    demoMode: config.demoMode,
    devShowMagicLink: config.devShowMagicLink,
    gemini: geminiEnabled(),
    geminiModel: geminiEnabled() ? config.gemini.model : null,
    solana: solanaEnabled(),
    googleTilesKey: config.googleTilesKey || null,
    database: db.timescale ? "Tiger Data (TimescaleDB)" : db.kind === "postgres" ? "Postgres" : "Embedded Postgres (PGlite)",
    timescale: db.timescale,
    schools: SCHOOLS.map((s) => ({ id: s.id, name: s.name, short: s.short, color: s.color, city: s.city, homeStations: s.homeStations, emailDomains: s.emailDomains, lat: s.lat, lon: s.lon })),
    personas: config.demoMode ? DEMO_PERSONAS.map((p) => ({ key: p.key, name: p.name, school: p.school })) : [],
  });
});

authRoutes.post("/auth/start", async (req, res) => {
  const body = z.object({ email: z.string().email(), name: z.string().min(1).max(40).optional() }).parse(req.body);
  if (!rateLimit(`auth:${req.ip}`, 8, 10 * 60_000)) throw new HttpError(429, "Too many sign-in attempts. Try again in a few minutes.");
  const school = schoolForEmail(body.email);
  if (!school) throw new HttpError(400, `Use your school email from one of: ${SCHOOLS.flatMap((s) => s.emailDomains.slice(0, 1)).join(", ")}`);
  const link = await issueLoginToken(body.email, "student", body.name);
  const sent = await sendEmail(
    body.email,
    "Your Charlie on the MTA sign-in link",
    `<p>Tap to sign in to Charlie on the MTA as a ${school.short} student:</p><p><a href="${link}">${link}</a></p><p>This link expires in 20 minutes. If you didn't ask for it, ignore this email.</p>`,
  );
  res.json({ ok: true, school: school.id, sent, devLink: config.devShowMagicLink ? link : undefined });
});

authRoutes.post("/auth/owner-start", async (req, res) => {
  const body = z.object({ email: z.string().email() }).parse(req.body);
  const db = await getDb();
  const p = await db.one("SELECT * FROM partners WHERE lower(owner_email)=lower($1)", [body.email]);
  // same response either way, so the endpoint doesn't reveal which emails are partners
  let devLink: string | undefined;
  if (p) {
    const link = await issueLoginToken(body.email, "owner");
    await sendEmail(body.email, "Charlie on the MTA owner sign-in", `<p><a href="${link}">Sign in to your owner page</a></p>`);
    if (config.devShowMagicLink) devLink = link;
  }
  res.json({ ok: true, devLink });
});

authRoutes.get("/auth/verify", async (req, res) => {
  const token = String(req.query.token || "");
  const db = await getDb();
  const t = await db.one(`SELECT * FROM login_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()`, [sha256(token)]);
  if (!t) return res.redirect("/?signin=expired");
  await db.query("UPDATE login_tokens SET used_at=now() WHERE token_hash=$1", [t.token_hash]);
  if (t.purpose === "owner") {
    const p = await db.one("SELECT id FROM partners WHERE lower(owner_email)=lower($1)", [t.email]);
    if (!p) return res.redirect("/?signin=expired");
    await createSession(res, { ownerPartnerId: p.id });
    return res.redirect("/owner");
  }
  const school = schoolForEmail(t.email)!;
  let user = await db.one("SELECT * FROM users WHERE email=$1", [t.email]);
  if (!user) {
    const id = newId("u_");
    const name = t.display_name || t.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()).slice(0, 30);
    await db.query(`INSERT INTO users (id, email, school_id, display_name, friend_code) VALUES ($1,$2,$3,$4,$5)`, [id, t.email, school.id, name, friendCode()]);
    user = { id };
  }
  await createSession(res, { userId: user.id });
  res.redirect("/");
});

authRoutes.post("/auth/demo", async (req, res) => {
  if (!config.demoMode) throw new HttpError(404, "Not found");
  const body = z.object({ persona: z.string().optional(), owner: z.boolean().optional() }).parse(req.body);
  const db = await getDb();
  if (body.owner) {
    const p = await db.one("SELECT id FROM partners WHERE is_sample ORDER BY created_at LIMIT 1");
    if (!p) throw new HttpError(404, "No sample partner seeded");
    await createSession(res, { ownerPartnerId: p.id });
    return res.json({ ok: true, owner: true });
  }
  const persona = DEMO_PERSONAS.find((p) => p.key === (body.persona || "priya")) ?? DEMO_PERSONAS[0];
  const user = await db.one("SELECT id FROM users WHERE email=$1", [persona.email]);
  if (!user) throw new HttpError(503, "Demo data is still seeding. Try again in a few seconds.");
  await createSession(res, { userId: user.id });
  res.json({ ok: true });
});

authRoutes.post("/auth/logout", async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});
