# Line Collector: BostonHacks 2026 final draft

Nov 22, 2026 · Team: Himani Patil, Aakanksha Chavan, Jay (Jianning) Qi, [4th member] · Repo: github.com/hap04114/line-collector (data pipeline from our T-Field repo)

## The one line

**Line Collector is how a new student becomes a Bostonian: food that tastes like home, a place to study, the T lines that get you there, and a school-vs-school game that makes you go.**

## Why it's different (lead with this, not the game)

Several teams built "collect Boston by eating or riding, plus a leaderboard." That's our engine, not our headline. What only we have:

1. **Built for newcomers, especially international students.** First Week in Boston (5 real-place quests), Taste of Home, halal/vegetarian/vegan filters, the whole app in Hindi (other languages through Gemini), $10 budgets.
2. **Safety.** A listing scam and broker-fee check (paste text or a screenshot) and verified student sublets with automatic checks, plus where to report a scam.
3. **Real local businesses.** Punch cards, owner-set slow-hour bonuses, 2-minute redemption codes, counter QR posters, and on-chain receipts. [Name the pilot spot if one agrees this morning; otherwise say "sample offers".]
4. **A fair rivalry.** Schools rank by average points per active player (minimum 10), so big schools don't win by size.
5. **The real city.** Street Runner runs your T line's real route through real streets and buildings, and the 3D map uses real OpenStreetMap buildings.

## The problem (research)

- **Lonely and stuck on campus:** 52% of students reported high loneliness (Healthy Minds 2024–25), first-years most. In one survey, 93% of first-years wanted more chances to leave campus, and every one said more food options would get them out (Carnegie Mellon).
- **New and carless:** 159,720 students at Boston's colleges (BPDA, fall 2022); 80,419 international students in Massachusetts (Open Doors 2025/26). International students name food from home as what they miss most.
- **Tight money:** 44% of Massachusetts public college students face food insecurity.
- **Renting is a trap:** tenant-paid broker fees banned Aug 1, 2025, yet listings still charge them (Globe); the FBI reported 490+ Boston-area rental fraud victims and $2.6M lost this year.

Pitch line: *"About half of college students report high loneliness, and first-years are hit hardest. Priya landed from India in August: no car, $10 for dinner, and she's never left campus. Line Collector is her first week in Boston."*

## What it does (as built)

- **Live map:** every T station, live trains, alerts, campuses; your stops fill in with your school's color; optional 3D game tokens.
- **First Week in Boston:** welcome (home region, language, budget), then five quests that each point at a real nearby place: a taste of home, a free landmark, a study spot, a line you've never ridden, and know your rights before you rent. Finishing all five earns *Bostonian in a Week*.
- **Find:** food or study spots near you, by budget, craving, diet and open now. With Gemini embeddings it searches by meaning ("cozy dumplings, cheap").
- **Check-in:** GPS within 150 m, a fresh photo (fingerprint), Gemini confirms it, then points with reasons, streaks with a monthly skip, 18 badges, levels, confetti.
- **Menu reader:** snap a menu and Gemini reads items and prices, so the spot gets a real price instead of an estimate.
- **Best time to go:** a heatmap of each spot's check-ins by day and hour.
- **Stop Planner (Mastra workflow):** "$10, two hours, spicy food, then somewhere quiet to study" runs understand → remember → propose → check → study → write, and every step is visible.
- **School board:** average per active player or total stops, a weekly race timeline with replay, your school, and friends.
- **Local partners:** punch cards, slow-hour bonuses, codes, an owner page with visits by hour, a QR counter poster, Solana receipts.
- **Live:** listing check, verified sublets (address, price vs. rent, scam text, reused photos, landlord consent), rent snapshot.
- **Ride:** line Chaos Score from live delays and alerts, the last-train nudge, the same-school Late-Night Ride Split with safety rules.
- **Street Runner:** run your line's real route through the real streets; arcade scores have their own board and never touch school points.
- **Chrome extension:** worst-line Chaos badge and shutdown alerts.

## Sponsors: one real job each (with live proof on the 🔧 How it's built page)

| Prize | What it does in the app | Why it was the right tool |
|---|---|---|
| **Gemini** | Five distinct uses: photo check-in verification; a **menu reader** that turns a photo into structured prices; a listing/screenshot **scam scan**; **embeddings** for search by meaning; translation for international students | Multimodal (photos, screenshots) and structured JSON output let us fill data no API has: real prices and scam signals |
| **Mastra** | The Stop Planner is a **6-step workflow** with per-student memory and a checking step (hours, line disruptions, budget, repeats) before anything is suggested | Judges see one-shot agents everywhere; a checked, personalized workflow is safer and visible |
| **Tiger Data** | One Postgres for everything: **hypertables** (check-ins, train positions, predictions, line metrics), **continuous aggregates** (weekly school board, delay by hour, visits by hour for the heatmap and owners), **pgvector** for search by meaning, and retention policies | Time-series and vector search in one database, with live aggregates driving three features |
| **Vultr** | API, web app and the 24/7 MBTA poller on one server with Caddy HTTPS; **Object Storage** for sublet photos, private check-in photos and nightly backups | HTTPS is what makes phone GPS and the camera work; the poller never sleeps |
| **GoDaddy Registry** | [domain] with QR counter posters for partners | A memorable link used in the real world |
| **Solana (stretch)** | **On-chain receipts** for reward redemptions, verifiable by the business | Not badges: other teams mint those. Receipts solve a real trust problem between businesses and apps |

## Three-minute demo

1. **Hook (20 s):** the research line, then Priya.
2. **First Week (60 s):** sign in as Priya → welcome → Day 1, a taste of home → check in with a photo → points, confetti, the board moves.
3. **Safety (30 s):** paste the example listing → broker fee, owner abroad, wire transfer flagged → where to report.
4. **Local partner (20 s):** the owner page: confirm a code, the QR poster, an on-chain receipt.
5. **Engine and tech (30 s):** the fair board and race replay; the Planner's workflow steps; the How it's built page (Tiger rows, aggregates, Vultr, Gemini).
6. **Close (10–20 s):** Street Runner on Kenmore Street. *"Line Collector is how a new student becomes a Bostonian."*

Backup: a pre-recorded 1-minute video and seeded demo players (labelled "(demo)").

## Judge questions

| Question | Answer |
|---|---|
| How is this different from the other "collect Boston" apps? | They're games. We're a newcomer's first week: home food, study spots, safe renting, real local businesses. The game is the engine. |
| Why would students keep using it? | They eat every day, and the game makes them eat somewhere new: weekly streaks with a skip, a Monday reset, partner punch cards. |
| Where do prices come from? | OpenStreetMap has none. Estimates are labelled "est."; students replace them by snapping the menu, and Gemini reads it. |
| Can people fake check-ins? | GPS within 150 m, a fresh photo fingerprint, Gemini checks the photo, 5 scored check-ins a day. |
| Doesn't the biggest school win? | No. We rank by average points per active player, minimum 10. |
| Are these real partners? | [Name it] / "Sample offers, clearly labelled; signing pilots is next." |
| Is the listing check legal advice? | No. It flags likely issues and links to the state's guidance and where to report. |
| Why Solana? | Receipts the business can verify without trusting us. |
| Was this built here? | Yes. The repo history starts during the event; the data pipeline came from our team's T-Field repo, also built here. |

## Devpost draft

**Line Collector** gets Boston students out of the campus bubble. A new student's first week becomes five quests to real places: food that tastes like home, a free landmark, a study spot, a T line they've never ridden, and how to rent without getting scammed. Check in with a photo to collect stops for your school's weekly board, ranked fairly per active player. Local spots run punch cards for their slow hours. And Street Runner lets you run your line through the real streets of Boston.

*How we built it:* TypeScript, Express, React, MapLibre GL with OpenFreeMap tiles; MBTA V3 API (live trains, predictions, alerts) on a poller; OpenStreetMap places with dietary tags from our T-Field pipeline; Gemini (vision, structured output, embeddings); a Mastra workflow; Tiger Data (hypertables, continuous aggregates, pgvector); Vultr compute and Object Storage with Caddy HTTPS; Solana devnet receipts; [domain].

*Challenges:* [fill in]. *Accomplishments:* [fill in]. *What we learned:* [fill in].
*What's next:* sign pilot partners, student-submitted menus at scale, a September 1 move-in event, then new residents and visitors.

## Be honest on stage

- Prices are estimates until a student scans the menu.
- Partner offers are samples unless a business agreed.
- The demo players are seeded and labelled "(demo)".
- "Simulate being here" is for judging only; turn `DEMO_MODE` off after.
- Don't claim the SpaceXSI raffle unless you actually used Grok Bot.

## Status and owners (fill in)

| Item | Status | Owner |
|---|---|---|
| Gemini key → real photo check, menu reader, scam scan, embeddings | needs key | |
| Tiger Cloud → hypertables, aggregates, pgvector verified on the proof page | needs connection string | |
| Vultr server + Object Storage + domain + HTTPS | needs accounts | |
| Pilot partner near the GSU (7 AM) | to do | |
| Track question to an organizer (Boundless Boston?) | to do | |
| 1-minute backup video | to do | |
| Devpost submitted (not Draft) by 8:30 | to do | |
