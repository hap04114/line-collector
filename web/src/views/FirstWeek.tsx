import { useEffect, useState } from "react";
import { api, fmtDist, money, qs } from "../api";
import { LANGS, useI18n } from "../i18n";
import { useStore } from "../store";
import { Sheet, Stepper } from "../components/Sheet";

export const HOMES = [
  ["south-asian", "🇮🇳 South Asia"], ["east-asian", "🇨🇳 East Asia"], ["southeast-asian", "🇻🇳 Southeast Asia"], ["middle-eastern", "🇱🇧 Middle East"],
  ["latin-american", "🇲🇽 Latin America"], ["caribbean", "🇯🇲 Caribbean"], ["african", "🇪🇹 Africa"], ["european", "🇮🇹 Europe"], ["mediterranean", "🇬🇷 Mediterranean"],
] as const;

export function useFirstWeek() {
  const s = useStore();
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    if (!s.me) return;
    api.get(`/first-week?${qs({ lat: s.pos?.lat, lon: s.pos?.lon })}`).then(setD).catch(() => {});
    // refresh when check-ins land (points change) or settings change
  }, [s.me?.points, s.me?.user?.homeRegions?.join(","), Math.round((s.pos?.lat ?? 0) * 200), Math.round((s.pos?.lon ?? 0) * 200)]);
  return d;
}

/** One-screen welcome for a new student: where's home, language, budget. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const s = useStore();
  const { lang, setLang } = useI18n();
  const [regions, setRegions] = useState<string[]>(s.me?.user?.homeRegions ?? []);
  const [budget, setBudget] = useState(Math.round((s.me?.user?.budgetCents ?? 1000) / 100));
  const save = async () => {
    await api.post("/me", { homeRegions: regions, budgetCents: budget * 100, lang });
    try { localStorage.setItem("lc-welcomed", "1"); } catch { /* ignore */ }
    await s.refresh();
    onDone();
  };
  return (
    <Sheet title={`👋 Welcome to Boston${s.me?.user?.name ? `, ${s.me.user.name.split(" ")[0].replace("(demo)", "")}` : ""}`} sub="Three questions, then your first week starts" onClose={save} full>
      <div className="card hero">
        No car, about $10 a meal, and a city you don't know yet. Line Collector gets you out of the campus bubble: food that tastes like home, places to study, and the T lines that get you there.
      </div>
      <div className="field">
        <label>Where's home? We'll find food that tastes like it.</label>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {HOMES.map(([id, label]) => (
            <button key={id} className={`chip ${regions.includes(id) ? "on" : ""}`} onClick={() => setRegions(regions.includes(id) ? regions.filter((r) => r !== id) : [...regions, id])}>{label}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Language</label>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {LANGS.map((l) => <button key={l.code} className={`chip ${lang === l.code ? "on" : ""}`} onClick={() => setLang(l.code)}>{l.label}</button>)}
        </div>
      </div>
      <div className="row between">
        <span className="small">Usual budget for a meal</span>
        <Stepper value={budget} min={5} max={30} step={1} format={(v) => `$${v}`} onChange={setBudget} />
      </div>
      <button className="btn primary block" onClick={save}>🗓️ Start my first week</button>
    </Sheet>
  );
}

/** The five newcomer quests, each pointing at a real place nearby. */
export function FirstWeekView() {
  const s = useStore();
  const d = useFirstWeek();
  const go = (t: any) => {
    if (!t) return;
    s.setPanel(null);
    s.openStation(t.stationId);
    s.flyTo(t.lat, t.lon, 16.2);
  };
  return (
    <Sheet title="🗓️ First Week in Boston" sub={d ? `${d.done} of ${d.total} done · how a new student becomes a Bostonian` : "Loading…"} onClose={() => s.setPanel(null)} full>
      {d && (
        <div className="bar" style={{ height: 12 }}><i style={{ width: `${(100 * d.done) / d.total}%`, background: "var(--accent)" }} /></div>
      )}
      {d?.done === d?.total && d && <div className="banner ok center"><div style={{ fontSize: 40 }}>🦞</div><b>Bostonian in a Week!</b> Badge earned.</div>}
      <div className="list">
        {d?.quests.map((q: any, i: number) => (
          <div key={q.id} className="card col" style={q.done ? { borderColor: "var(--ok)", opacity: 0.85 } : undefined}>
            <div className="row">
              <div style={{ fontSize: 28 }}>{q.done ? "✅" : q.icon}</div>
              <div className="grow">
                <div className="tiny muted" style={{ fontWeight: 700 }}>DAY {i + 1}</div>
                <b>{q.title}</b>
                <div className="small muted">{q.why}</div>
              </div>
            </div>
            {!q.done && q.needsSetup && <button className="btn" onClick={() => s.setPanel("welcome")}>Tell us where home is</button>}
            {!q.done && q.target && (
              <button className="spot" onClick={() => go(q.target)}>
                <div className="grow">
                  <b>{q.target.name}</b>
                  <div className="small muted">
                    {q.target.station && q.target.station !== q.target.name && <>near {q.target.station} · </>}
                    {fmtDist(q.target.distanceM)} away
                    {q.target.lines && <> · new line{q.target.lines.length > 1 ? "s" : ""}: {q.target.lines.map((r: string) => s.routeById.get(r)?.short).join(", ")}</>}
                  </div>
                </div>
                {q.target.priceCents > 0 && <div className="price">{money(q.target.priceCents)}{q.target.priceSource === "estimate" && <div className="tiny muted">est.</div>}</div>}
                <span className="btn sm primary">Go</span>
              </button>
            )}
            {!q.done && q.id === "rights" && (
              <button className="btn" onClick={() => s.setPanel("live")}>🔎 Check a listing (try the example)</button>
            )}
          </div>
        ))}
      </div>
      <div className="tiny muted">Quests complete when you check in at a matching place. Your progress also counts toward your school's board.</div>
    </Sheet>
  );
}
