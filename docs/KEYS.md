# Keys and accounts to collect

Put every value in `.env` on the server (copy `.env.example`). `.env` is gitignored: never commit it, never paste keys in public channels.

| # | What | Why | Where to get it | `.env` name(s) |
|---|---|---|---|---|
| 1 | **Gemini API key** | Photo check-in, menu reader, listing scam scan, search by meaning, workflow understand/write, translation | aistudio.google.com/apikey → Create API key | `GEMINI_API_KEY` (optional `GEMINI_MODEL`, default `gemini-flash-latest`) |
| 2 | **Tiger Cloud connection string** | Hypertables, continuous aggregates, pgvector search | console.cloud.timescale.com → Create service → copy the connection string (password shown once). Then in the SQL editor run `CREATE EXTENSION IF NOT EXISTS vector;` (the app also tries this at startup) | `DATABASE_URL` (ends with `?sslmode=require`) |
| 3 | **Vultr server** | Hosts the API, web app, 24/7 MBTA poller, HTTPS | vultr.com (MLH credit code from the BostonHacks Devpost/sponsor page) → Deploy → Cloud Compute → Shared CPU → Ubuntu 24.04 → 2 GB → New York (NJ). Note the IP and root password | none (we SSH in) |
| 4 | **Vultr Object Storage** | Sublet photos, private check-in photos, nightly backups | Vultr → Products → Object Storage → Add (NJ, ewr1) → create bucket `line-collector` → copy hostname, access key, secret key | `VULTR_S3_ENDPOINT` (e.g. `https://ewr1.vultrobjects.com`), `VULTR_S3_BUCKET`, `VULTR_S3_ACCESS_KEY`, `VULTR_S3_SECRET_KEY` |
| 5 | **Domain (GoDaddy Registry)** | The link judges open; QR posters | MLH promo from GoDaddy Registry. Try `linecollector.boston` (another team registered a .boston), else `.tech`/`.xyz`. DNS: A record `@` → Vultr IP, A record `owner` → Vultr IP | `DOMAIN`, `PUBLIC_URL=https://<domain>` |
| 6 | MBTA V3 API key (optional) | Higher rate limit for live trains | api-v3.mbta.com → Request a key | `MBTA_API_KEY` |
| 7 | Resend key (optional) | Real sign-in emails to school inboxes | resend.com → API key. Sending to any address needs the domain verified in Resend (add its DNS records) | `RESEND_API_KEY`, `EMAIL_FROM=Charlie on the MTA <hi@yourdomain>` |
| 8 | RentCast key (optional) | Rent snapshot, "too good to be true" price check | app.rentcast.io → developer plan (50 requests/month) → then `npm run bake:rent -- --limit 40` | `RENTCAST_API_KEY` |
| 10 | **Google API key (server)** | Real transit/walk/bike times and turn-by-turn directions ("How to get there"); ratings, real prices, verified hours and closed status for spots | console.cloud.google.com (billing on) → enable **Routes API** (`/apis/library/routes.googleapis.com`) and **Places API (New)** (`/apis/library/places.googleapis.com`) → Credentials → Create API key → API restrictions: only those two; application restrictions: none (server-side key). Without it, travel uses T-Field's estimates | `GOOGLE_API_KEY` |
| 11 | Eventbrite token (optional) | $0 Boston events from chosen Eventbrite organizers (public search was retired) | eventbrite.com/platform/api-keys → private token; add organizer IDs to `data/event-sources.json` | `EVENTBRITE_TOKEN` |
| 9 | Solana devnet wallet | On-chain receipts for reward redemptions | Nothing to collect: `npm run solana:wallet` creates it and prints the line for `.env` | `SOLANA_SECRET_KEY` |

## After the keys are in

```bash
npm run embed:spots          # Gemini embeddings into Tiger (pgvector) for search by meaning
npm run bake:vibes -- place-nuniv place-bucen place-buest   # Gemini vibe tags at demo stops
npm run solana:wallet        # devnet wallet + airdrop
npm run enrich:google        # Google Places: ratings, prices, hours, closed status for the 400 spots nearest stations (needs GOOGLE_API_KEY)
docker compose up -d --build # on the Vultr server
```

Check everything on the in-app **🔧 How it's built** page (Me → How it's built): each sponsor shows "live" or "not configured".

## Do not claim

- **SpaceXSI raffle**: requires code written in Cursor with Grok Bot. This repo was built with Claude Code. Only claim it if the team actually used Grok Bot, and log honestly what for.
