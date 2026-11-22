# Line Collector

**Cheap food and study spots you can reach by T right now, plus a game your whole school plays.**
BostonHacks 2026 · Track: Bos(tons) of Eats and Streets (Transit Gamification as the second angle).

Line Collector puts every MBTA subway stop on a live 3D map of Boston. Tap a stop to see three spots under your budget, filtered by craving, vibe, and whether they're open now or past midnight. Ride there, eat, and snap a photo. Once the photo checks out, the stop is yours. Stops fill in with your school's color, and the seven schools race on a weekly board that resets every Monday.

## Quick start

```bash
npm install
npm run dev          # API on :8787, web app on :5173
```

Open http://localhost:5173 and tap **Priya · Northeastern** to try the demo. No keys or database setup are needed:

- The database is embedded Postgres (PGlite) in `.data/`. Set `DATABASE_URL` to use Tiger Data.
- Live trains, alerts and predictions come from the MBTA V3 API (works without a key at a low rate limit).
- Without `GEMINI_API_KEY`, every AI feature falls back to rules: photos are accepted unchecked, the listing check uses rules only, and the planner runs its tools in a fixed order.

Production-style run: `npm run build && npm start`, then open http://localhost:8787.

Copy `.env.example` to `.env` to add keys. `npm test` runs the unit tests for scoring, streaks, events and listing rules.

## What's built

| Area | What it does |
|---|---|
| **Map** | OpenFreeMap tiles on MapLibre GL with 3D buildings, every T line, trains moving in real time, your GPS position, tinted campuses, your nearest station and campus. Day/night styles. |
| **Explore** | Three spots under budget per station (craving, Taste of Home, vibe, open now, open past midnight), free landmark hangouts, neighborhood stamps with one-liners, local tips. |
| **Check-in** | GPS within 150 m (400 m for big landmarks), photo fingerprint (dHash) must be new, Gemini confirms the photo, 5 scored check-ins a day and one per spot. Slow Gemini → saved as pending and scored when the answer arrives. |
| **Game** | The design doc's points table, x4 multiplier cap, weekly streak with one free skip a month, levels Newcomer→Townie, 18 badges, bring-a-friend (both students get x2), away games, neutral ground, shutdown x1.5, Chaos bonus, Warm-Up quests, events as data. |
| **Board** | Schools ranked by average points per active player (min 10) or total stops; weekly race timeline; your school; friends by code. |
| **Your Boston** | Money saved vs. your usual near-campus meal, neighborhoods explored out of 23, local spots supported. |
| **Partner rewards** | Punch cards, 6-digit codes that expire in 2 minutes, owner page (`/owner`) with offers, slow-hour bonuses and visits by hour. |
| **Study** | Libraries and wifi cafés per station; students rate outlets, noise and wifi after checking in. |
| **Live** | Listing check (broker fee, payment, owner-abroad, no-viewing, pressure, upfront-cost and price flags), verified student sublets with automatic checks and trust badges, rent snapshot. |
| **Ride** | Live Chaos Score per line, last-train nudge, same-school Late-Night Ride Split with the safety rules from the doc. |
| **Planner** | Mastra agent on Gemini with six tools; every tool call is shown step by step. |
| **Languages** | English and Hindi built in; other languages translated by Gemini and cached. |
| **Chrome extension** | `extension/`: worst-line Chaos badge and shutdown notifications. Load it unpacked in `chrome://extensions`. |

## Sponsors: what each one does

- **Gemini API**: photo check-in verification, listing and screenshot scam scan, tip moderation, vibe tags (`npm run bake:vibes`), translation, and the model behind the Mastra agent. Model name is set in `.env` (`GEMINI_MODEL`, default `gemini-flash-latest`).
- **Mastra**: the Stop Planner agent (`server/src/services/planner.ts`) with tools `nearestStations`, `lineAlerts`, `findFood`, `findStudySpots`, `rentSnapshot` and `weatherNow`. `GET /api/plan?q=...`.
- **Tiger Data**: with `DATABASE_URL` pointing at Tiger Cloud, `checkins`, `train_positions`, `train_predictions` and `line_metrics` become hypertables. `weekly_user_points` (the school board), `line_metrics_15m` (delay by hour) and `spot_visits_hourly` (the owner chart) are continuous aggregates with refresh policies; raw train data has retention policies. See `server/src/db/schema.ts`.
- **Vultr**: `docker compose up -d --build` runs the API, the 24/7 MBTA poller and the web app, with Caddy for automatic HTTPS. GPS on phones only works over HTTPS.
- **GoDaddy Registry domain**: point the domain's A record at the Vultr server and set `DOMAIN` in `.env`.
- **Solana**: each partner reward redemption is written to devnet as an on-chain receipt the business can verify (`npm run solana:wallet`, then `SOLANA_SECRET_KEY`).

## Deploy on Vultr

1. **Server:** Vultr Cloud Compute, Shared CPU, Ubuntu 24.04, 2 GB RAM, New York (NJ). SSH in, install Docker with `curl -fsSL https://get.docker.com | sh`, then `git clone` this repo and `cd` into it.
2. **Keys:** copy the working `.env` from the demo laptop to the server privately, e.g. `scp .env root@<server-ip>:~/line-collector/.env`. Never commit it or paste it in a shared channel. On the server, set `DOMAIN` (docker-compose sets `PUBLIC_URL` from it).
   - No domain yet? Use `<ip-with-dashes>.sslip.io` (e.g. `45-77-10-20.sslip.io`). It's free, needs no DNS, and Caddy still gets a real HTTPS certificate, which phone GPS needs.
   - With a domain: add an A record `@` pointing at the server IP.
3. **Google 3D tiles key:** in Google Cloud → Credentials → the browser key (`GOOGLE_MAPS_API_KEY`) → Websites, add `https://<domain>/*`. Without it, the Photoreal map and Street Runner fall back to the Realistic look on their own.
4. **Run:** `docker compose up -d --build`. Then check `https://<domain>/api/health`; `https://<domain>/api/proof` shows each sponsor live.
5. **After it's live:** stop the app on the demo laptop. Otherwise two MBTA pollers write duplicate train data into Tiger.
6. **Updates:** `git pull && docker compose up -d --build`.

| `.env` key | Needed? | What it does |
|---|---|---|
| `DATABASE_URL` | Required | Tiger Cloud (TimescaleDB) |
| `GEMINI_API_KEY` | Required | Photo check, planner, scam scan, search |
| `DEMO_MODE=true`, `DEV_SHOW_MAGIC_LINK=true` | Keep on for judging | Demo sign-in buttons, and the sign-in link on screen (Resend's test sender only emails the account owner) |
| `GOOGLE_MAPS_API_KEY` | Recommended | Photoreal map and Street Runner (browser key, restricted by website) |
| `GOOGLE_API_KEY` | Recommended | Directions (Routes API) and place lookups (Places API (New)); server key, no website restriction |
| `MBTA_API_KEY` | Recommended | Live trains at 1,000 requests/min instead of 20 |
| `SOLANA_SECRET_KEY` | Optional | On-chain receipts for reward redemptions (devnet wallet, funded) |
| `RESEND_API_KEY` | Optional | Sign-in emails |
| `VULTR_S3_ENDPOINT`, `VULTR_S3_BUCKET`, `VULTR_S3_ACCESS_KEY`, `VULTR_S3_SECRET_KEY` | Optional | Photos and nightly backups in Vultr Object Storage (otherwise local disk) |
| `RENTCAST_API_KEY` | Optional | Rent data and listings; needs an active RentCast plan, so leave it empty otherwise |
| `EVENTBRITE_TOKEN` | Optional | More events in $0 Boston |

Google ratings, prices and hours are not in git (Google's terms). To show them on the server, run `docker compose exec app npm run enrich:google -- 400` after deploying. It's billed per place, and must be re-run after a rebuild.

## Data

| Need | Source | Notes |
|---|---|---|
| Lines, stations, shapes | MBTA V3 API | Saved to `data/mbta.json` by `npm run bake:mbta` |
| Commuter Rail lines and stops | MBTA V3 API | 13 lines, 143 stops in `data/commuter-rail.json` (`npm run bake:commuter`). On the map and in Street Runner; check-ins and the school board stay subway-only |
| Live trains, alerts, predictions | MBTA V3 API | Poller: vehicles every 10–15 s, predictions every 30 s, alerts every 2 min |
| Food, study and park spots | OpenStreetMap via Overpass | 1,615 spots within ~450 m of stations, saved to `data/spots.json` |
| Neighborhoods | Analyze Boston (2020 census-tract approximation) | 23 neighborhoods; Cambridge and Medford/Somerville are bonus areas by station city |
| ZIP per station, sublet addresses | US Census geocoder | Free, no key |
| Rent | RentCast | `npm run bake:rent` with `RENTCAST_API_KEY`; cached per ZIP |
| Weather | Open-Meteo | Warm-Up quests at feels-like ≤ 25°F or snow |

## 3D character credits

Street Runner's real look uses two character files from the three.js examples (`web/public/models/`): **Michelle** (the runner) and **Soldier** (only its Run, Walk, Idle and TPose motion clips; it is never drawn). Both are Adobe Mixamo characters and animations, which Mixamo allows in projects royalty-free. Each frame, the soldier's motion is retargeted onto Michelle's skeleton in code (`StreetRunner.tsx`, `applyRetarget`). The 🍬 Colorful look keeps the original cartoon runner.

## Be honest on stage

- **Google data is a demo-day lookup, not a database.** `npm run enrich:google` fetched ratings, price ranges, hours and open/closed status from Google Places for the 400 food spots closest to T stations. Google's terms don't allow storing or republishing that content, so `data/google-places.json` stays on the demo machine and is gitignored. In production the app would look these up live when a spot is opened. Travel times and directions (Routes API) are fetched live and never stored.
- **Prices are estimates where Google has none.** OSM has no prices, so each spot's price comes from its type and cuisine and is labelled "est." Put hand-checked prices in `data/price-overrides.json` as `{ "<spot id>": { "priceCents": 750, "cheapestItem": "Cheese slice" } }`, then restart. Those show as checked.
- **Partner offers are samples.** Four independent spots near the GSU and Northeastern carry offers labelled "Sample offer", and their owner page says the business has not agreed to a partnership. Swap in real pilots in the `partners` table if any spot agrees.
- **Demo players are seeded.** Each school has 12 players flagged `is_demo` (names end in "(demo)"), so the board isn't empty. Their check-ins went through the real scoring code. Reset them with `npm run seed -- --reset-demo`.
- **Demo location.** With `DEMO_MODE=true`, the check-in screen offers "simulate being here (judging only)" so you can show a Northeastern check-in from the BU GSU. Turn `DEMO_MODE` off after judging.
- **Rent data** is empty until someone runs `npm run bake:rent` with a RentCast key.

## Before the demo

- [ ] Confirm each school's email domains and subdomains (`server/src/data/schools.ts`).
- [ ] Fact-check the neighborhood one-liners (`server/src/data/neighborhoods.ts`).
- [ ] Confirm the event dates in `server/src/db/seed.ts` (finals week, Marathon Monday, Head of the Charles, move-in). Rows marked `needs_confirmation` are guesses.
- [ ] Add `GEMINI_API_KEY` and try a real photo check-in, the listing check and the planner.
- [ ] Point `DATABASE_URL` at Tiger Cloud and confirm the startup log lists the continuous aggregates.
- [ ] Run `npm run bake:vibes -- place-nuniv place-bucen place-buest` for Gemini vibe tags at the demo stops.
- [ ] Hand-check 5–10 demo spot prices into `data/price-overrides.json`.

## Project layout

```
server/src/
  index.ts            Express app, routes, static web app
  config.ts           env settings (Boston time zone)
  auth.ts             school-email magic links, cookie sessions
  db/                 Postgres/PGlite adapter, schema (+ Timescale), seeding
  services/           scoring, check-in, events, transit poller, listing check, planner, spots, badges
  routes/             auth, game, community (tips/rewards/owner), live (sublets), ride, ai
  lib/                Gemini, geo, hours, photo hashes, weather/geocoder/email/Solana
web/src/              React app: map, station sheet, check-in, board, plan, me, live, ride, owner
scripts/              bake MBTA, neighborhoods, spots, rent, vibes; Solana wallet
extension/            Chrome extension (MV3)
data/                 baked data the app loads at boot
```

## API

`POST /api/auth/start` · `GET /api/map` · `GET /api/spots?stop=&budget=&craving=&vibe=&openNow=&openLate=` · `POST /api/checkin` · `GET /api/me` · `GET /api/leaderboard/schools?view=average|stops` · `GET/POST /api/tips` · `POST /api/tips/:id/helpful` · `GET /api/rewards` · `POST /api/redeem` · `POST /api/partners/confirm` · `POST /api/partners/offers` · `GET /api/partners/stats` · `POST/GET /api/sublets` · `POST /api/listing-check` · `POST/GET /api/rides` · `GET /api/rides/nudge` · `GET /api/plan` · `GET /api/trains` · `GET /api/lines/status` · `GET /api/lines/:id/reliability`

## Credits

Map data © OpenStreetMap contributors (ODbL), tiles by OpenFreeMap / OpenMapTiles. Transit data from the MBTA V3 API. Neighborhood boundaries from Analyze Boston. Weather from Open-Meteo.

## Final draft and keys

- [docs/FINAL_DRAFT.md](docs/FINAL_DRAFT.md): pitch, what sets us apart, sponsors, demo script, judge answers, Devpost text
- [docs/KEYS.md](docs/KEYS.md): every key and account to collect, and where each goes
- In the app: Me → 🔧 How it's built shows live proof for each sponsor

## Working together (avoid clashes)

- Never work directly on `main`. Make a branch: `git checkout -b <yourname>/<what>` (e.g. `aakanksha/vultr-deploy`).
- Before you start and before you push: `git pull --rebase origin main`.
- Push your branch and open a pull request; merge it once it builds (`npm run typecheck && npm test && npm run build`).
- Keys only ever go in `.env` (gitignored). Never commit them.
- Areas: Himani owns `web/` UI and the game; Aakanksha owns deployment (`Dockerfile`, `docker-compose.yml`, `Caddyfile`, server `.env`) and sponsor accounts. Touching the other's area? Say so in the team chat first.
