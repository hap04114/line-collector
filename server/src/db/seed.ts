/**
 * Seeding.
 *  seedStatic(): schools, neighborhoods (+ boundaries), stations, spots + landmarks,
 *                Boston-calendar events and clearly-labelled SAMPLE partner offers. Idempotent.
 *  seedDemo():   demo players for all seven schools (is_demo = true) so the school board
 *                isn't empty at judging. Their check-ins run through the real scoring code.
 *
 *   npm run seed            seed static + demo (if missing)
 *   npm run seed -- --reset-demo   wipe demo players and re-seed them
 */
import { pathToFileURL } from "node:url";
import type { Db } from "./index.js";
import { SCHOOLS } from "../data/schools.js";
import { LANDMARKS, NEIGHBORHOODS } from "../data/neighborhoods.js";
import { NB_FEATURES, PRICE_OVERRIDES, SPOTS_FILE, STATIONS, neighborhoodAt, stationById } from "../lib/static.js";
import { friendCode, newId } from "../lib/util.js";
import { weekStart, addDays } from "../lib/time.js";
import { checkIn } from "../services/checkin.js";

export async function seedStatic(db: Db) {
  await db.tx(async (q) => {
    for (const s of SCHOOLS) {
      await q.query(
        `INSERT INTO schools (id, name, short, city, color, email_domains, home_stations, lat, lon) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, short=EXCLUDED.short, city=EXCLUDED.city, color=EXCLUDED.color,
           email_domains=EXCLUDED.email_domains, home_stations=EXCLUDED.home_stations, lat=EXCLUDED.lat, lon=EXCLUDED.lon`,
        [s.id, s.name, s.short, s.city, s.color, s.emailDomains, s.homeStations, s.lat, s.lon],
      );
    }
    for (const n of NEIGHBORHOODS) {
      const f = NB_FEATURES.find((x) => x.id === n.id);
      await q.query(
        `INSERT INTO neighborhoods (id, name, kind, blurb, stamp_color, stamp_icon, boundary) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, kind=EXCLUDED.kind, blurb=EXCLUDED.blurb, stamp_color=EXCLUDED.stamp_color,
           stamp_icon=EXCLUDED.stamp_icon, boundary=EXCLUDED.boundary`,
        [n.id, n.name, n.kind, n.blurb, n.color, n.icon, f ? JSON.stringify(f.geometry) : null],
      );
    }
    for (const s of STATIONS) {
      await q.query(
        `INSERT INTO stations (id, name, lat, lon, municipality, routes, neighborhood_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, lat=EXCLUDED.lat, lon=EXCLUDED.lon, municipality=EXCLUDED.municipality,
           routes=EXCLUDED.routes, neighborhood_id=EXCLUDED.neighborhood_id`,
        [s.id, s.name, s.lat, s.lon, s.municipality, s.routes, s.neighborhoodId],
      );
    }
  });

  const spots = SPOTS_FILE.spots as any[];
  {
    // batch upsert spots
    const chunk = 150;
    for (let i = 0; i < spots.length; i += chunk) {
      const part = spots.slice(i, i + chunk);
      const values: unknown[] = [];
      const rows = part.map((s, j) => {
        const st = stationById.get(s.stationId);
        const ov = PRICE_OVERRIDES[s.id];
        values.push(
          s.id, s.osmId, s.name, s.kind, s.amenity, s.stationId, s.lat, s.lon, s.distanceM, s.cuisines, s.region,
          ov?.priceCents ?? s.priceCents, ov ? "checked" : s.priceSource, ov?.cheapestItem ?? null, s.hours, s.vibes, s.vibeSource,
          s.localOwned, s.brand, s.wifi, s.study, neighborhoodAt(s.lat, s.lon, st?.municipality), s.address, s.website,
          s.kind === "hangout" ? 250 : 150, s.diet ?? [],
        );
        const o = j * 26;
        return `(${Array.from({ length: 26 }, (_, k) => `$${o + k + 1}`).join(",")})`;
      });
      await db.query(
        `INSERT INTO spots (id, osm_id, name, kind, amenity, station_id, lat, lon, distance_m, cuisines, region, price_cents, price_source,
           cheapest_item, hours, vibes, vibe_source, local_owned, brand, wifi, study, neighborhood_id, address, website, checkin_radius_m, diet)
         VALUES ${rows.join(",")}
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, amenity=EXCLUDED.amenity, price_cents=EXCLUDED.price_cents,
           price_source=EXCLUDED.price_source, cheapest_item=EXCLUDED.cheapest_item, hours=EXCLUDED.hours, vibes=EXCLUDED.vibes,
           vibe_source=EXCLUDED.vibe_source, neighborhood_id=EXCLUDED.neighborhood_id, diet=EXCLUDED.diet`,
        values,
      );
    }
  }
  for (const l of LANDMARKS) {
    const st = stationById.get(l.stationId)!;
    await db.query(
      `INSERT INTO spots (id, name, kind, amenity, station_id, lat, lon, price_cents, price_source, vibes, vibe_source, local_owned, neighborhood_id, description, checkin_radius_m)
       VALUES ($1,$2,'landmark','landmark',$3,$4,$5,0,'free',$6,'curated',true,$7,$8,400)
       ON CONFLICT (id) DO UPDATE SET description=EXCLUDED.description, lat=EXCLUDED.lat, lon=EXCLUDED.lon`,
      [l.id, l.name, l.stationId, l.lat, l.lon, ["photogenic", "good for groups"], neighborhoodAt(l.lat, l.lon, st.municipality), l.blurb],
    );
  }
  await seedEvents(db);
  await seedSamplePartners(db);
  const n = await db.one<{ n: number }>("SELECT count(*)::int AS n FROM spots");
  console.log(`[seed] static data ready: ${SCHOOLS.length} schools, ${NEIGHBORHOODS.length} neighborhoods, ${STATIONS.length} stations, ${n?.n} spots`);
}

async function seedEvents(db: Db) {
  const green = ["Green-B", "Green-C", "Green-D", "Green-E"];
  const ev = [
    { id: "green-shutdown-2026-12", name: "x2 Green Line shutdown weekend", kind: "shutdown", start: "2026-12-04T00:00:00-05:00", end: "2026-12-08T04:00:00-05:00",
      rule: { multiplier: 2, lines: green }, description: "The Green Line closes Dec 4–7. Stops on it are worth double.", confirm: false },
    { id: "finals-fall-2026", name: "Finals week", kind: "flag", start: "2026-12-09T00:00:00-05:00", end: "2026-12-20T00:00:00-05:00",
      rule: { flag: "finals" }, description: "Night Owl check-ins after 10 PM count.", confirm: true },
    { id: "finals-late-night-2026", name: "x2 finals late-night challenge", kind: "seasonal", start: "2026-12-09T00:00:00-05:00", end: "2026-12-20T00:00:00-05:00",
      rule: { multiplier: 2, startHour: 22, endHour: 4 }, description: "Night Owl doubles during finals: x2 from 10 PM to 4 AM.", confirm: true },
    { id: "first-snow-2026", name: "+50 first snow", kind: "seasonal", start: "2026-11-15T00:00:00-05:00", end: "2027-04-01T00:00:00-04:00",
      rule: { bonus: 50, requires: "snow" }, description: "It's snowing: every scored check-in gets +50.", confirm: false },
    { id: "marathon-monday-2027", name: "x1.5 Marathon Monday", kind: "boston", start: "2027-04-19T00:00:00-04:00", end: "2027-04-20T00:00:00-04:00",
      rule: { multiplier: 1.5 }, description: "Patriots' Day: Boston Marathon. Cheer, then explore.", confirm: true },
    { id: "move-in-2027", name: "+50 first-week quests", kind: "seasonal", start: "2027-09-01T00:00:00-04:00", end: "2027-09-15T00:00:00-04:00",
      rule: { bonus: 50, flag: "first-week" }, description: "September 1 move-in and the first two weeks: +50 per new stop.", confirm: true },
    { id: "head-of-the-charles-2027", name: "x1.5 Head of the Charles", kind: "boston", start: "2027-10-16T00:00:00-04:00", end: "2027-10-18T00:00:00-04:00",
      rule: { multiplier: 1.5, lines: ["Red", "Green-B"] }, description: "Regatta weekend on the river: Red and Green B stops x1.5.", confirm: true },
  ];
  for (const e of ev) {
    await db.query(
      `INSERT INTO events (id, name, description, kind, starts_at, ends_at, rule, needs_confirmation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, starts_at=EXCLUDED.starts_at,
         ends_at=EXCLUDED.ends_at, rule=EXCLUDED.rule, needs_confirmation=EXCLUDED.needs_confirmation`,
      [e.id, e.name, e.description, e.kind, e.start, e.end, JSON.stringify(e.rule), e.confirm],
    );
  }
}

/** Sample partner offers near the GSU on Comm Ave and Northeastern. Always labelled "Sample offer". */
async function seedSamplePartners(db: Db) {
  const have = await db.one<{ n: number }>("SELECT count(*)::int AS n FROM partners");
  if ((have?.n ?? 0) > 0) return;
  const picks: any[] = [];
  for (const [stationId, n] of [["place-bucen", 2], ["place-buest", 1], ["place-nuniv", 1]] as const) {
    const rows = await db.query(
      `SELECT id, name FROM spots WHERE station_id=$1 AND kind='food' AND local_owned AND price_cents <= 1000 AND id <> ALL($2) ORDER BY distance_m LIMIT $3`,
      [stationId, picks.map((p) => p.id), n],
    );
    picks.push(...rows);
  }
  const rewards = ["Free drink with any meal", "Free topping or side", "$2 off your order", "Free drink with any meal"];
  for (const [i, s] of picks.entries()) {
    const pid = newId("pt_");
    await db.query(`INSERT INTO partners (id, spot_id, owner_email, owner_name, is_sample) VALUES ($1,$2,$3,$4,true)`, [
      pid, s.id, `owner-${i + 1}@sample.linecollector.invalid`, `Sample owner (${s.name})`,
    ]);
    const oid = newId("of_");
    const slow = { days: [1, 2, 3, 4, 5], startHour: 14, endHour: 17, multiplier: 2 };
    await db.query(`INSERT INTO offers (id, partner_id, title, stamps_needed, slow_hours, active) VALUES ($1,$2,$3,5,$4,true)`, [oid, pid, rewards[i % rewards.length], JSON.stringify(slow)]);
    await syncSlowHourEvent(db, oid, s.id, s.name, slow);
  }
  console.log(`[seed] ${picks.length} sample partner offers (labelled as samples)`);
}

export async function syncSlowHourEvent(db: { query: Db["query"] }, offerId: string, spotId: string, spotName: string, slow: any, active = true) {
  await db.query("DELETE FROM events WHERE id=$1", [`slow-${offerId}`]);
  if (!slow || !active) return;
  await db.query(
    `INSERT INTO events (id, name, description, kind, starts_at, ends_at, rule, partner_id) VALUES ($1,$2,$3,'partner',$4,$5,$6,$7)`,
    [
      `slow-${offerId}`,
      `x${slow.multiplier} slow-hour bonus at ${spotName}`,
      `Owner bonus: x${slow.multiplier} ${hourLabel(slow.startHour)}–${hourLabel(slow.endHour)}`,
      "2026-01-01T00:00:00-05:00",
      "2030-01-01T00:00:00-05:00",
      JSON.stringify({ multiplier: slow.multiplier, spotIds: [spotId], days: slow.days, startHour: slow.startHour, endHour: slow.endHour }),
      offerId,
    ],
  );
}
const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;

// ---- demo players ---------------------------------------------------------------
const FIRST = ["Aisha", "Ben", "Carmen", "Dev", "Elena", "Femi", "Grace", "Hiro", "Isabel", "Jonah", "Kavya", "Liam", "Mei", "Nadia", "Omar", "Paolo", "Quinn", "Rosa", "Sam", "Tariq", "Uma", "Victor", "Wen", "Ximena", "Yusuf", "Zoe"];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export const DEMO_PERSONAS = [
  { key: "priya", email: "priya@demo.linecollector.invalid", name: "Priya (demo)", school: "neu", regions: ["south-asian"], budget: 1000 },
  { key: "jake", email: "jake@demo.linecollector.invalid", name: "Jake (demo)", school: "bu", regions: [], budget: 1200 },
];

export async function seedDemo(db: Db, reset = false) {
  if (reset) {
    const ids = (await db.query<{ id: string }>("SELECT id FROM users WHERE is_demo")).map((r) => r.id);
    for (const t of ["checkins", "collections", "user_neighborhoods", "badges", "friendships", "redemptions", "tips", "study_ratings", "sessions"]) {
      await db.query(`DELETE FROM ${t} WHERE user_id = ANY($1)`, [ids]);
    }
    await db.query("DELETE FROM users WHERE is_demo");
  }
  const have = await db.one<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE is_demo");
  if ((have?.n ?? 0) > 0) return;
  console.log("[seed] creating demo players for all seven schools (one moment)…");
  const rand = rng(20261121);
  const foodByStation = new Map<string, string[]>();
  for (const r of await db.query<{ id: string; station_id: string }>("SELECT id, station_id FROM spots WHERE kind IN ('food','landmark','study')")) {
    const a = foodByStation.get(r.station_id) || [];
    a.push(r.id);
    foodByStation.set(r.station_id, a);
  }
  const stationIds = [...foodByStation.keys()];
  const now = new Date();
  const thisWeek = weekStart(now);

  const mkUser = async (email: string, name: string, school: string, regions: string[] = [], budget = 1000) => {
    const id = newId("u_");
    await db.query(
      `INSERT INTO users (id, email, school_id, display_name, friend_code, is_demo, home_regions, budget_cents) VALUES ($1,$2,$3,$4,$5,true,$6,$7)`,
      [id, email, school, name, friendCode(), regions, budget],
    );
    return id;
  };
  const doCheckins = async (userId: string, plan: { stationId: string; at: Date }[]) => {
    for (const p of plan) {
      const spots = foodByStation.get(p.stationId);
      if (!spots?.length) continue;
      const user = await db.one("SELECT * FROM users WHERE id=$1", [userId]);
      const spotId = spots[Math.floor(rand() * spots.length)];
      try {
        await checkIn(db, user, { spotId, demoLocation: true, skipPhotoCheck: true, at: p.at, isDemo: true });
      } catch {
        /* cap or duplicate spot: skip */
      }
    }
  };
  const nearHome = (schoolId: string) => {
    const home = SCHOOLS.find((s) => s.id === schoolId)!.homeStations;
    const lines = new Set(home.flatMap((h) => stationById.get(h)?.routes ?? []));
    return stationIds.filter((id) => stationById.get(id)!.routes.some((r) => lines.has(r)));
  };
  const randomTime = (from: Date, to: Date) => {
    const t = new Date(from.getTime() + rand() * Math.max(0, to.getTime() - from.getTime()));
    t.setHours(11 + Math.floor(rand() * 10), Math.floor(rand() * 60));
    return t > now ? new Date(now.getTime() - 3600_000 * (1 + rand() * 5)) : t;
  };

  // Personas: Priya (new, barely explored), Jake (same three places).
  const priya = await mkUser(DEMO_PERSONAS[0].email, DEMO_PERSONAS[0].name, "neu", DEMO_PERSONAS[0].regions, 1000);
  await doCheckins(priya, [
    { stationId: "place-nuniv", at: randomTime(addDays(thisWeek, -7), addDays(thisWeek, -5)) },
    { stationId: "place-rugg", at: randomTime(addDays(thisWeek, -4), addDays(thisWeek, -2)) },
  ]);
  const jake = await mkUser(DEMO_PERSONAS[1].email, DEMO_PERSONAS[1].name, "bu", [], 1200);
  const jakeStops = ["place-bucen", "place-buest", "place-kencl"];
  await doCheckins(jake, [-20, -13, -9, -6, -2].map((d, i) => ({ stationId: jakeStops[i % 3], at: randomTime(addDays(thisWeek, d), addDays(thisWeek, d + 1)) })));

  // 12 players per school, history over the last 3 weeks, active this week.
  let k = 0;
  for (const school of SCHOOLS) {
    const local = nearHome(school.id);
    for (let i = 0; i < 12; i++) {
      const name = `${FIRST[(k++ * 7) % FIRST.length]} ${String.fromCharCode(65 + Math.floor(rand() * 26))}. (demo)`;
      const uid = await mkUser(`demo-${school.id}-${i + 1}@demo.linecollector.invalid`, name, school.id);
      const plan: { stationId: string; at: Date }[] = [];
      const weeksBack = 1 + Math.floor(rand() * 3);
      for (let w = weeksBack; w >= 0; w--) {
        const n = w === 0 ? 1 + Math.floor(rand() * 4) : 1 + Math.floor(rand() * 3);
        for (let j = 0; j < n; j++) {
          const pool = rand() < 0.65 ? local : stationIds;
          const from = addDays(thisWeek, -7 * w + j);
          plan.push({ stationId: pool[Math.floor(rand() * pool.length)], at: randomTime(from, addDays(from, 1)) });
        }
      }
      plan.sort((a, b) => a.at.getTime() - b.at.getTime());
      await doCheckins(uid, plan);
    }
  }
  const c = await db.one<{ n: number }>("SELECT count(*)::int AS n FROM checkins WHERE is_demo");
  console.log(`[seed] demo players ready (${c?.n} demo check-ins). They are flagged is_demo and labelled in the app.`);
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const { getDb } = await import("./index.js");
  const { migrate } = await import("./schema.js");
  const db = await getDb();
  await migrate(db);
  await seedStatic(db);
  await seedDemo(db, process.argv.includes("--reset-demo"));
  await db.close();
}
