/**
 * Schema. Core tables match the design doc ("How we build the game and sublets"):
 * schools, users, neighborhoods, spots, checkins, weekly_school_points, tips, partners,
 * offers, redemptions, badges, events, sublets, rides — plus support tables.
 *
 * On Tiger Data (TimescaleDB):
 *  - checkins, train_positions, train_predictions and line_metrics are hypertables
 *  - weekly_user_points, line_metrics_15m and spot_visits_hourly are continuous aggregates
 *  - weekly_school_points is a view over weekly_user_points (avg per active player, stops)
 * On embedded PGlite the same names exist as plain views, so queries are identical.
 */
import type { Db } from "./index.js";

const CORE = /* sql */ `
CREATE TABLE IF NOT EXISTS schools (
  id text PRIMARY KEY,
  name text NOT NULL,
  short text NOT NULL,
  city text,
  color text NOT NULL,
  email_domains text[] NOT NULL,
  home_stations text[] NOT NULL,
  lat float8, lon float8
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text UNIQUE NOT NULL,
  school_id text NOT NULL REFERENCES schools(id),
  display_name text NOT NULL,
  friend_code text UNIQUE NOT NULL,
  total_points int NOT NULL DEFAULT 0,
  level text NOT NULL DEFAULT 'Newcomer',
  streak_weeks int NOT NULL DEFAULT 0,
  streak_last_week date,
  skips_left int NOT NULL DEFAULT 1,
  skips_month text,
  lang text NOT NULL DEFAULT 'en',
  home_regions text[] NOT NULL DEFAULT '{}',
  budget_cents int NOT NULL DEFAULT 1000,
  baseline_cents int NOT NULL DEFAULT 1500,
  contact text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text,
  owner_partner_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash text PRIMARY KEY,
  email text NOT NULL,
  purpose text NOT NULL DEFAULT 'student',
  display_name text,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS friendships (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS neighborhoods (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,
  blurb text,
  stamp_color text,
  stamp_icon text,
  boundary jsonb
);

CREATE TABLE IF NOT EXISTS stations (
  id text PRIMARY KEY,
  name text NOT NULL,
  lat float8 NOT NULL, lon float8 NOT NULL,
  municipality text,
  routes text[] NOT NULL,
  neighborhood_id text
);

CREATE TABLE IF NOT EXISTS spots (
  id text PRIMARY KEY,
  osm_id text,
  name text NOT NULL,
  kind text NOT NULL,                 -- food | study | hangout | landmark
  amenity text,
  station_id text NOT NULL,
  lat float8 NOT NULL, lon float8 NOT NULL,
  distance_m int,
  cuisines text[] NOT NULL DEFAULT '{}',
  region text,
  price_cents int NOT NULL DEFAULT 0,
  price_source text NOT NULL DEFAULT 'estimate',
  cheapest_item text,
  hours text,
  vibes text[] NOT NULL DEFAULT '{}',
  vibe_source text,
  local_owned boolean NOT NULL DEFAULT true,
  brand text,
  wifi boolean NOT NULL DEFAULT false,
  study boolean NOT NULL DEFAULT false,
  neighborhood_id text,
  address text,
  website text,
  description text,
  checkin_radius_m int NOT NULL DEFAULT 150
);
CREATE INDEX IF NOT EXISTS spots_station_idx ON spots (station_id);

CREATE TABLE IF NOT EXISTS checkins (
  id text NOT NULL,
  ts timestamptz NOT NULL,
  user_id text NOT NULL,
  school_id text NOT NULL,
  spot_id text NOT NULL,
  station_id text NOT NULL,
  lines text[] NOT NULL DEFAULT '{}',
  neighborhood_id text,
  kind text NOT NULL,
  points int NOT NULL DEFAULT 0,
  reasons jsonb NOT NULL DEFAULT '[]',
  context jsonb,
  photo_hash text,
  verified text NOT NULL,             -- verified | pending | rejected | unchecked
  verify_note text,
  is_new_stop boolean NOT NULL DEFAULT false,
  friend_checkin_id text,
  distance_m int,
  is_demo boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id, ts)
);
CREATE INDEX IF NOT EXISTS checkins_user_idx ON checkins (user_id, ts DESC);
CREATE INDEX IF NOT EXISTS checkins_spot_idx ON checkins (spot_id, ts DESC);
CREATE INDEX IF NOT EXISTS checkins_hash_idx ON checkins (photo_hash);

CREATE TABLE IF NOT EXISTS collections (
  user_id text NOT NULL,
  station_id text NOT NULL,
  first_ts timestamptz NOT NULL,
  checkin_id text NOT NULL,
  verified text NOT NULL DEFAULT 'verified',
  PRIMARY KEY (user_id, station_id)
);

CREATE TABLE IF NOT EXISTS user_neighborhoods (
  user_id text NOT NULL,
  neighborhood_id text NOT NULL,
  first_ts timestamptz NOT NULL,
  PRIMARY KEY (user_id, neighborhood_id)
);

CREATE TABLE IF NOT EXISTS badges (
  user_id text NOT NULL,
  badge_id text NOT NULL,
  earned_at timestamptz NOT NULL DEFAULT now(),
  solana_sig text,
  solana_status text,
  meta jsonb,
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS tips (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  station_id text NOT NULL,
  text text NOT NULL,
  helpful_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'live',  -- live | hidden | rejected
  screen_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, station_id)
);
CREATE TABLE IF NOT EXISTS tip_votes (tip_id text NOT NULL, user_id text NOT NULL, PRIMARY KEY (tip_id, user_id));
CREATE TABLE IF NOT EXISTS tip_reports (tip_id text NOT NULL, user_id text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tip_id, user_id));

CREATE TABLE IF NOT EXISTS partners (
  id text PRIMARY KEY,
  spot_id text UNIQUE NOT NULL,
  owner_email text NOT NULL,
  owner_name text,
  is_sample boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offers (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  title text NOT NULL,
  stamps_needed int NOT NULL DEFAULT 5,
  slow_hours jsonb,                     -- {"days":[1..5],"startHour":14,"endHour":17,"multiplier":2}
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redemptions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  offer_id text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS redemptions_code_idx ON redemptions (code);

CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  kind text NOT NULL,                  -- boston | seasonal | shutdown | partner | flag
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  rule jsonb NOT NULL,
  partner_id text,
  needs_confirmation boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS sublets (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  school_id text NOT NULL,
  title text NOT NULL,
  address text NOT NULL,
  zip text,
  lat float8, lon float8,
  station_id text,
  walk_min int,
  commute_min int,
  start_date date,
  end_date date,
  price_cents int NOT NULL,
  bedrooms int,
  description text,
  photos text[] NOT NULL DEFAULT '{}',
  photo_hashes text[] NOT NULL DEFAULT '{}',
  landlord_consent boolean NOT NULL DEFAULT false,
  contact text NOT NULL,
  flags jsonb NOT NULL DEFAULT '[]',
  badges text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',   -- pending | live | flagged | hidden
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sublet_requests (
  id text PRIMARY KEY,
  sublet_id text NOT NULL,
  user_id text NOT NULL,
  message text,
  contact text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sublet_id, user_id)
);
CREATE TABLE IF NOT EXISTS sublet_reports (sublet_id text NOT NULL, user_id text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (sublet_id, user_id));

CREATE TABLE IF NOT EXISTS rides (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  school_id text NOT NULL,
  from_station text NOT NULL,
  to_area text NOT NULL,
  depart_at timestamptz NOT NULL,
  window_min int NOT NULL DEFAULT 20,
  seats int NOT NULL DEFAULT 2,
  note text,
  contact text NOT NULL,
  status text NOT NULL DEFAULT 'open',      -- open | full | cancelled | hidden
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ride_requests (
  id text PRIMARY KEY,
  ride_id text NOT NULL,
  user_id text NOT NULL,
  contact text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id, user_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  target_kind text NOT NULL,
  target_id text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS blocks (user_id text NOT NULL, blocked_id text NOT NULL, PRIMARY KEY (user_id, blocked_id));

CREATE TABLE IF NOT EXISTS study_ratings (
  spot_id text NOT NULL,
  user_id text NOT NULL,
  outlets int NOT NULL, noise int NOT NULL, wifi int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (spot_id, user_id)
);

CREATE TABLE IF NOT EXISTS translations (lang text NOT NULL, key text NOT NULL, text text NOT NULL, PRIMARY KEY (lang, key));

CREATE TABLE IF NOT EXISTS arcade_scores (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  school_id text NOT NULL,
  route_id text NOT NULL,
  score int NOT NULL,
  distance_m int NOT NULL,
  tokens int NOT NULL,
  stations int NOT NULL,
  duration_ms int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS arcade_route_idx ON arcade_scores (route_id, score DESC);

-- ---- time series (hypertables on Tiger Data) -------------------------------
CREATE TABLE IF NOT EXISTS train_positions (
  ts timestamptz NOT NULL,
  route_id text NOT NULL,
  vehicle_id text NOT NULL,
  direction_id int,
  lat float8, lon float8, bearing float8,
  stop_id text,
  status text
);
CREATE INDEX IF NOT EXISTS train_positions_route_idx ON train_positions (route_id, ts DESC);

CREATE TABLE IF NOT EXISTS train_predictions (
  ts timestamptz NOT NULL,
  route_id text NOT NULL,
  trip_id text NOT NULL,
  stop_id text,
  direction_id int,
  predicted_at timestamptz,
  scheduled_at timestamptz,
  delay_s int
);
CREATE INDEX IF NOT EXISTS train_predictions_route_idx ON train_predictions (route_id, ts DESC);

CREATE TABLE IF NOT EXISTS line_metrics (
  ts timestamptz NOT NULL,
  route_id text NOT NULL,
  vehicles int NOT NULL DEFAULT 0,
  avg_delay_s float8,
  p90_delay_s float8,
  max_severity int NOT NULL DEFAULT 0,
  alert_count int NOT NULL DEFAULT 0,
  shuttle boolean NOT NULL DEFAULT false,
  chaos int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS line_metrics_route_idx ON line_metrics (route_id, ts DESC);

CREATE TABLE IF NOT EXISTS alerts_current (
  id text PRIMARY KEY,
  routes text[] NOT NULL,
  stops text[] NOT NULL DEFAULT '{}',
  effect text,
  severity int,
  header text,
  description text,
  lifecycle text,
  active_from timestamptz,
  active_to timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

const TIMESCALE: string[] = [
  `SELECT create_hypertable('checkins', 'ts', if_not_exists => TRUE, migrate_data => TRUE)`,
  `SELECT create_hypertable('train_positions', 'ts', if_not_exists => TRUE, migrate_data => TRUE, chunk_time_interval => INTERVAL '1 day')`,
  `SELECT create_hypertable('train_predictions', 'ts', if_not_exists => TRUE, migrate_data => TRUE, chunk_time_interval => INTERVAL '1 day')`,
  `SELECT create_hypertable('line_metrics', 'ts', if_not_exists => TRUE, migrate_data => TRUE, chunk_time_interval => INTERVAL '7 days')`,

  // Weekly points per player, bucketed on Boston Mondays; real-time so this week is always current.
  `CREATE MATERIALIZED VIEW IF NOT EXISTS weekly_user_points
     WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
   SELECT time_bucket(INTERVAL '1 week', ts, 'America/New_York') AS week,
          school_id, user_id,
          sum(points) AS points,
          sum(CASE WHEN is_new_stop THEN 1 ELSE 0 END) AS new_stops,
          count(*) AS checkins
   FROM checkins
   GROUP BY 1, 2, 3
   WITH NO DATA`,
  `SELECT add_continuous_aggregate_policy('weekly_user_points',
     start_offset => INTERVAL '5 weeks', end_offset => INTERVAL '1 minute',
     schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE)`,

  // Line reliability: 15-minute buckets of delay and chaos, the source of "delay by hour".
  `CREATE MATERIALIZED VIEW IF NOT EXISTS line_metrics_15m
     WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
   SELECT time_bucket(INTERVAL '15 minutes', ts) AS bucket, route_id,
          avg(avg_delay_s) AS avg_delay_s, max(p90_delay_s) AS p90_delay_s,
          max(max_severity) AS max_severity, avg(chaos) AS chaos, avg(vehicles) AS vehicles,
          bool_or(shuttle) AS shuttle
   FROM line_metrics
   GROUP BY 1, 2
   WITH NO DATA`,
  `SELECT add_continuous_aggregate_policy('line_metrics_15m',
     start_offset => INTERVAL '3 days', end_offset => INTERVAL '15 minutes',
     schedule_interval => INTERVAL '15 minutes', if_not_exists => TRUE)`,

  // Partner visits by hour for the owner page.
  `CREATE MATERIALIZED VIEW IF NOT EXISTS spot_visits_hourly
     WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
   SELECT time_bucket(INTERVAL '1 hour', ts) AS bucket, spot_id, count(*) AS visits
   FROM checkins
   GROUP BY 1, 2
   WITH NO DATA`,
  `SELECT add_continuous_aggregate_policy('spot_visits_hourly',
     start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 hour',
     schedule_interval => INTERVAL '30 minutes', if_not_exists => TRUE)`,

  `SELECT add_retention_policy('train_positions', INTERVAL '14 days', if_not_exists => TRUE)`,
  `SELECT add_retention_policy('train_predictions', INTERVAL '30 days', if_not_exists => TRUE)`,
];

const FALLBACK_VIEWS: Record<string, string> = {
  weekly_user_points: /* sql */ `
CREATE OR REPLACE VIEW weekly_user_points AS
SELECT (date_trunc('week', ts AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York') AS week,
       school_id, user_id,
       sum(points)::int AS points,
       sum(CASE WHEN is_new_stop THEN 1 ELSE 0 END)::int AS new_stops,
       count(*)::int AS checkins
FROM checkins GROUP BY 1, 2, 3`,
  line_metrics_15m: /* sql */ `
CREATE OR REPLACE VIEW line_metrics_15m AS
SELECT to_timestamp(floor(extract(epoch FROM ts) / 900) * 900) AS bucket, route_id,
       avg(avg_delay_s) AS avg_delay_s, max(p90_delay_s) AS p90_delay_s,
       max(max_severity) AS max_severity, avg(chaos) AS chaos, avg(vehicles) AS vehicles,
       bool_or(shuttle) AS shuttle
FROM line_metrics GROUP BY 1, 2`,
  spot_visits_hourly: /* sql */ `
CREATE OR REPLACE VIEW spot_visits_hourly AS
SELECT date_trunc('hour', ts) AS bucket, spot_id, count(*)::int AS visits
FROM checkins GROUP BY 1, 2`,
};

// Fair school board: average points per active player this week, plus total new stops.
const SCHOOL_VIEW = /* sql */ `
CREATE OR REPLACE VIEW weekly_school_points AS
SELECT week, school_id,
       sum(points)::int AS total_points,
       count(*)::int AS active_players,
       (sum(points)::float8 / greatest(count(*), 1)) AS avg_points,
       sum(new_stops)::int AS stops
FROM weekly_user_points
WHERE checkins > 0
GROUP BY week, school_id;
`;

export async function migrate(db: Db) {
  await db.exec(CORE);
  const caggs = new Set<string>();
  if (db.timescale) {
    for (const stmt of TIMESCALE) {
      const view = Object.keys(FALLBACK_VIEWS).find((v) => stmt.includes(`MATERIALIZED VIEW IF NOT EXISTS ${v}`));
      try {
        await db.exec(stmt);
        if (view) caggs.add(view);
      } catch (e) {
        console.warn(`[db] timescale step skipped: ${(e as Error).message.split(/\r?\n/)[0]}`);
      }
    }
  }
  for (const [view, sql] of Object.entries(FALLBACK_VIEWS)) if (!caggs.has(view)) await db.exec(sql);
  await db.exec(SCHOOL_VIEW);
  db.caggs = [...caggs];
  console.log(
    `[db] ${db.kind}${db.timescale ? ` + TimescaleDB (hypertables; continuous aggregates: ${[...caggs].join(", ") || "none"})` : " (plain views)"} ready`,
  );
}
