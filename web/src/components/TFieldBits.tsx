/** T-Field pieces for the food lists: allergy and place-type filters, warnings and info badges, and travel by mode. */
import { useEffect, useState } from "react";
import { api, fmtDist, money, qs } from "../api";
import { useStore } from "../store";

// ---- shared preferences (one per viewer, kept in sync between open lists) -------------------------
export interface TFieldPrefs { avoid: string[]; venue: string[]; showClosed: boolean; speed: number; accessible: boolean }
const KEY = "lc-tfield";
const DEFAULT: TFieldPrefs = { avoid: [], venue: [], showClosed: false, speed: 1.3, accessible: false };
const load = (): TFieldPrefs => { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEFAULT; } };

export function useTFieldPrefs() {
  const [prefs, setPrefs] = useState<TFieldPrefs>(load);
  useEffect(() => {
    const on = () => setPrefs(load());
    window.addEventListener("lc-tfield", on);
    return () => window.removeEventListener("lc-tfield", on);
  }, []);
  const update = (patch: Partial<TFieldPrefs>) => {
    const next = { ...load(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window */ }
    setPrefs(next);
    window.dispatchEvent(new Event("lc-tfield"));
  };
  return { prefs, update };
}

/** Query params the /spots and /find routes understand. */
export const tfieldQuery = (p: TFieldPrefs) => ({ avoid: p.avoid.join(","), venue: p.venue.join(","), showClosed: p.showClosed ? 1 : "" });

let metaCache: Promise<any> | null = null;
const useMeta = () => {
  const [m, setM] = useState<any>(null);
  useEffect(() => { (metaCache ??= api.get("/tfield/meta").catch(() => null)).then(setM); }, []);
  return m;
};

const ALLERGEN_LABEL: Record<string, string> = {
  milk: "🥛 Milk", egg: "🥚 Egg", fish: "🐟 Fish", shellfish: "🦐 Shellfish", seafood: "🌊 Seafood", tree_nut: "🌰 Tree nuts",
  peanut: "🥜 Peanuts", wheat: "🌾 Wheat", soy: "🫘 Soy", sesame: "Sesame",
};

// ---- filters --------------------------------------------------------------------------------------
export function FoodFilters() {
  const { prefs, update } = useTFieldPrefs();
  const meta = useMeta();
  const [open, setOpen] = useState(false);
  const count = prefs.avoid.length + prefs.venue.length + (prefs.showClosed ? 1 : 0);
  const toggle = (k: "avoid" | "venue", v: string) => update({ [k]: prefs[k].includes(v) ? prefs[k].filter((x) => x !== v) : [...prefs[k], v] } as any);
  return (
    <div className="col" style={{ gap: 8 }}>
      <button className={`chip ${count ? "on" : ""}`} style={{ alignSelf: "flex-start" }} onClick={() => setOpen(!open)} aria-expanded={open}>
        ⚠️ Allergies & place type{count ? ` (${count})` : ""} {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="card col" style={{ gap: 8 }}>
          <b className="small">Avoid</b>
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {(meta?.allergens ?? Object.keys(ALLERGEN_LABEL)).map((a: string) => (
              <button key={a} className={`chip ${prefs.avoid.includes(a) ? "on" : ""}`} onClick={() => toggle("avoid", a)}>{ALLERGEN_LABEL[a] ?? a}</button>
            ))}
          </div>
          <div className="tiny muted">Places likely to contain these are hidden; ones that often do get a warning. {meta?.disclaimer ?? "Allergen info is estimated. Always confirm with the restaurant."}</div>
          <b className="small">Type of place</b>
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {(meta?.venueTypes ?? []).map((v: any) => (
              <button key={v.id} className={`chip ${prefs.venue.includes(v.id) ? "on" : ""}`} onClick={() => toggle("venue", v.id)}>{v.label}</button>
            ))}
          </div>
          <label className="check"><input type="checkbox" checked={prefs.showClosed} onChange={(e) => update({ showClosed: e.target.checked })} /> Also show places that will be closed when I get there</label>
        </div>
      )}
    </div>
  );
}

// ---- badges on a spot ------------------------------------------------------------------------------
const VENUE: Record<string, string> = { restaurant: "Restaurant", quick_service: "Quick service", cafe: "Café", bakery: "Bakery", dessert: "Dessert", bubble_tea: "Bubble tea", bar_pub: "Bar / pub", food_hall: "Food hall", food_truck: "Food truck", grocery_deli: "Grocery / deli" };

export function SpotBadges({ spot }: { spot: any }) {
  if (spot.kind !== "food") return null;
  const svc = spot.service ?? {};
  const info = [
    spot.venueType && VENUE[spot.venueType],
    svc.takeout === true && "Takeout",
    svc.dineIn === true && "Dine-in",
    svc.delivery === true && "Delivery",
  ].filter(Boolean) as string[];
  const warn = (spot.warnings ?? []) as string[];
  if (!info.length && !warn.length && spot.rating == null && spot.priceMinCents == null && spot.availability !== "unavailable") return null;
  return (
    <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
      {spot.availability === "unavailable" && <span className="tag danger">Closed when you arrive</span>}
      {warn.filter((w) => w !== "Closed when you arrive").map((w) => <span key={w} className={`tag ${/contains|Closes|closed/i.test(w) ? "warn" : ""}`}>{/contains/.test(w) ? "⚠️ " : ""}{w}</span>)}
      {spot.rating != null && <span className="tag gold">★ {Number(spot.rating).toFixed(1)}{spot.ratingCount ? ` (${spot.ratingCount})` : ""}</span>}
      {spot.priceMinCents != null && spot.priceMaxCents != null && <span className="tag">{money(spot.priceMinCents)}–{money(spot.priceMaxCents)} per person</span>}
      {info.map((x) => <span key={x} className="tag">{x}</span>)}
    </div>
  );
}

// ---- how to get there --------------------------------------------------------------------------------
const MODE_ICON: Record<string, string> = { walk: "🚶", t: "🚇", t_bus: "🚌", bike: "🚲", rideshare: "🚗" };
const BAND: Record<string, { label: string; cls: string }> = { near: { label: "near", cls: "ok" }, medium: { label: "medium", cls: "" }, far: { label: "far", cls: "warn" } };

export function GetThere({ spot }: { spot: { id: string; lat: number; lon: number; name: string } }) {
  const s = useStore();
  const { prefs, update } = useTFieldPrefs();
  const [d, setD] = useState<any>(null);
  const [docks, setDocks] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const school = s.config?.schools.find((c) => c.id === s.me?.user?.school?.id);
  const from = s.pos ? { lat: s.pos.lat, lon: s.pos.lon, label: "you" } : school ? { lat: school.lat, lon: school.lon, label: `${school.short} campus` } : { lat: 42.3564, lon: -71.0624, label: "Park Street" };

  useEffect(() => {
    setErr(null);
    api.get(`/travel?${qs({ lat: from.lat.toFixed(5), lon: from.lon.toFixed(5), toLat: spot.lat, toLon: spot.lon, speed: prefs.speed, accessible: prefs.accessible ? 1 : "" })}`)
      .then(setD).catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot.id, prefs.speed, prefs.accessible, Math.round(from.lat * 1000), Math.round(from.lon * 1000)]);
  useEffect(() => { api.get(`/bluebikes/near?${qs({ lat: spot.lat, lon: spot.lon, need: "any" })}`).then((r) => setDocks(r.docks)).catch(() => setDocks([])); }, [spot.id]);

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row between">
        <b className="small">🧭 How to get there <span className="muted" style={{ fontWeight: 400 }}>from {from.label}</span></b>
        {d && <span className="tiny muted">{d.source === "google" ? "Google directions" : "estimate"}</span>}
      </div>
      <div className="row between small">
        <label htmlFor={`spd-${spot.id}`}>Walking speed</label>
        <span className="muted">{prefs.speed.toFixed(1)} m/s{prefs.speed <= 0.9 ? " · slower" : prefs.speed >= 1.5 ? " · brisk" : ""}</span>
      </div>
      <input id={`spd-${spot.id}`} type="range" min={0.6} max={1.6} step={0.1} value={prefs.speed} onChange={(e) => update({ speed: +e.target.value })} style={{ width: "100%", accentColor: "var(--accent)" }} />
      <label className="check small"><input type="checkbox" checked={prefs.accessible} onChange={(e) => update({ accessible: e.target.checked })} /> Step-free / less walking</label>
      {err && <div className="tiny muted">{err}</div>}
      {d?.options.map((o: any) => (
        <div key={o.preset} className="card tight col" style={{ gap: 6, cursor: "pointer" }} onClick={() => setOpen(open === o.preset ? null : o.preset)} role="button" aria-expanded={open === o.preset}>
          <div className="row between">
            <span className="small">{MODE_ICON[o.preset]} {o.label}</span>
            <span className="row" style={{ gap: 6 }}>
              {o.band ? <span className={`tag ${BAND[o.band].cls}`}>{BAND[o.band].label}</span> : <span className="tag">too far</span>}
              <b>{o.minutes} min</b>
            </span>
          </div>
          {open === o.preset && (
            <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
              {o.steps.map((st: any, i: number) => (
                <li key={i}>
                  {st.line && <span className="tag" style={{ background: st.line.color ?? undefined, color: st.line.color ? "#fff" : undefined, borderColor: "transparent", marginRight: 4 }}>{st.line.name}</span>}
                  {st.text}{st.from && st.to ? `: ${st.from} → ${st.to}` : ""}{st.stops ? ` (${st.stops} stops)` : ""}
                  <span className="muted"> · {st.minutes} min{st.distanceM ? ` · ${fmtDist(st.distanceM)}` : ""}</span>
                </li>
              ))}
            </ol>
          )}
          {open === o.preset && o.note && <div className="tiny muted">{o.note}</div>}
        </div>
      ))}
      {docks && docks.length > 0 && (
        <div className="tiny muted">
          🚲 Blue Bikes here: {docks.slice(0, 2).map((k) => `${k.name} (${k.bikes} bikes, ${k.docks} docks, ${fmtDist(k.distanceM)})`).join(" · ")}
        </div>
      )}
    </div>
  );
}
