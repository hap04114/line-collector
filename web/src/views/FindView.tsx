import { useEffect, useState } from "react";
import { api, fmtDist, money, qs } from "../api";
import { useI18n } from "../i18n";
import { spotEmoji, useStore } from "../store";
import { Sheet, Stepper } from "../components/Sheet";
import { FoodFilters, SpotBadges, tfieldQuery, useTFieldPrefs } from "../components/TFieldBits";

/** Find food or a study spot near you, across every nearby station, sorted by walking distance. */
export function FindView({ initialKind = "food" }: { initialKind?: "food" | "study" }) {
  const s = useStore();
  const { t } = useI18n();
  const [kind, setKind] = useState<"food" | "study">(initialKind);
  const [text, setText] = useState("");
  const [budget, setBudget] = useState(Math.round((s.me?.user?.budgetCents ?? 1500) / 100));
  const [craving, setCraving] = useState("");
  const [openNow, setOpenNow] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tfq = tfieldQuery(useTFieldPrefs().prefs);

  useEffect(() => {
    const h = setTimeout(() => {
      setBusy(true);
      setErr(null);
      api
        .get(`/find?${qs({ kind, q: text, budget: kind === "food" ? budget : undefined, craving: kind === "food" ? craving : undefined, openNow, lat: s.pos?.lat, lon: s.pos?.lon, ...(kind === "food" ? tfq : {}) })}`)
        .then(setRes)
        .catch((e) => setErr(e.message))
        .finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(h);
  }, [kind, text, budget, craving, openNow, s.pos?.lat, s.pos?.lon, tfq.avoid, tfq.venue, tfq.showClosed]);

  const open = (sp: any) => {
    s.setPanel(null);
    s.openStation(sp.stationId);
    s.flyTo(sp.lat, sp.lon, 16.5);
  };

  const cravings = [...(s.me?.user?.homeRegions?.length ? [{ id: "home", label: `🏠 ${t("tasteOfHome")}` }] : []), ...(s.statics?.cravings ?? [])];
  return (
    <Sheet title="🔍 Find" sub={res?.origin?.startsWith("campus") ? `Near ${res.origin.slice(7)} campus (turn on location for spots near you)` : "Near you"} onClose={() => s.setPanel(null)} full>
      <div className="seg">
        <button className={kind === "food" ? "on" : ""} onClick={() => setKind("food")}>🍜 Eat</button>
        <button className={kind === "study" ? "on" : ""} onClick={() => setKind("study")}>📚 Study</button>
      </div>
      <input className="input" autoFocus placeholder={kind === "food" ? "Try: cozy dumplings, cheap · spicy and late · ramen…" : "Search: library, café, station…"} value={text} onChange={(e) => setText(e.target.value)} />
      {kind === "food" && (
        <>
          <div className="row between">
            <span className="small muted">{t("budget")}</span>
            <Stepper value={budget} min={3} max={40} step={1} format={(v) => `$${v}`} onChange={setBudget} />
          </div>
          <div className="chips">
            {cravings.map((c) => <button key={c.id} className={`chip ${craving === c.id ? "on" : ""}`} onClick={() => setCraving(craving === c.id ? "" : c.id)}>{c.label}</button>)}
          </div>
          <FoodFilters />
        </>
      )}
      <div className="chips">
        <button className={`chip ${openNow ? "on" : ""}`} onClick={() => setOpenNow(!openNow)}>🕒 {t("openNow")}</button>
      </div>
      {err && <div className="banner danger">{err}</div>}
      <div className="small muted">{busy ? "Searching…" : res ? `${res.total} ${kind === "food" ? "places" : "study spots"}${res.mode?.startsWith("meaning") ? "" : " within a 20-minute walk"}` : ""}{res?.mode?.startsWith("meaning") && <span className="tag ok" style={{ marginLeft: 6 }}>🧠 search by {res.mode}</span>}</div>
      <div className="list">
        {res?.spots.map((sp: any) => (
          <button key={sp.id} className="spot" onClick={() => open(sp)}>
            <div className="emoji">{spotEmoji(sp.kind === "food" || kind === "food" ? sp : { ...sp, kind: "study" })}</div>
            <div className="grow">
              <div className="row wrap" style={{ gap: 6 }}>
                <b>{sp.name}</b>
                {sp.partner && <span className="tag gold">⭐ {t("localPartner")}</span>}
                {sp.diet?.map((d: string) => <span key={d} className="tag ok">🥗 {d.replace("?", "").replace("_", "-")}</span>)}
              </div>
              <div className="small muted">
                {fmtDist(sp.distanceM)} · {sp.walkMin} {t("walk")} · near {sp.station}
                {sp.openNow === true && " · open now"}
                {sp.openNow === false && " · closed now"}
                {sp.nextChange && ` · ${sp.nextChange}`}
              </div>
              {kind === "food" && <SpotBadges spot={sp} />}
              {kind === "study" && sp.study_rating && <div className="tiny">🔌 {sp.study_rating.outlets}/5 · 🤫 {sp.study_rating.noise}/5 · 📶 {sp.study_rating.wifi}/5</div>}
              {kind === "study" && !sp.study_rating && <div className="tiny muted">{sp.kind === "study" ? "Library" : "Café with wifi"} · no student ratings yet</div>}
            </div>
            {kind === "food" && (
              <div className="price">
                {sp.kind === "food" ? money(sp.priceCents) : "free"}
                {sp.priceSource === "estimate" && <div className="tiny muted" style={{ fontWeight: 600 }}>{t("estimate")}</div>}
              </div>
            )}
          </button>
        ))}
        {res && !res.spots.length && <div className="banner">Nothing matches. Try a bigger budget, fewer filters, or another word.</div>}
      </div>
    </Sheet>
  );
}
