import { useState } from "react";
import { api, qs } from "../api";
import { useI18n } from "../i18n";
import { useStore } from "../store";
import { Sheet } from "../components/Sheet";

const EXAMPLES = [
  "$10, two hours, spicy food, then somewhere quiet to study",
  "Cheap noodles open late, then a library",
  "Something sweet under $8 near me",
  "$12 taste of home, and is rent cheap around there?",
];

const TOOL_ICON: Record<string, string> = { understand: "🧠", remember: "💾", propose: "📍", check: "✅", study: "📚", write: "✍️", nearestStations: "📍", lineAlerts: "🚦", findFood: "🍜", findStudySpots: "📚", rentSnapshot: "🏠", weatherNow: "🌡️" };

export function PlanView() {
  const s = useStore();
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const run = async (query = q) => {
    if (!query.trim()) return;
    setQ(query);
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      setRes(await api.get(`/plan?${qs({ q: query, lat: s.pos?.lat, lon: s.pos?.lon })}`));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const show = (stationId: string) => {
    const st = s.stationById.get(stationId);
    s.openStation(stationId);
    if (st) s.flyTo(st.lat, st.lon, 15.5);
  };

  return (
    <Sheet title={`✨ ${t("planTitle")}`} sub="Mastra workflow · Gemini · live MBTA · your history" onClose={() => s.setPanel(null)} full>
      <div className="field">
        <label htmlFor="pq">{t("planHint")}</label>
        <textarea id="pq" className="input" style={{ minHeight: 80 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={EXAMPLES[0]} />
      </div>
      <div className="chips">
        {EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => run(e)}>{e}</button>)}
      </div>
      <button className="btn primary block" disabled={busy || !q.trim()} onClick={() => run()}>{busy ? "Planning…" : `✨ ${t("planGo")}`}</button>
      {err && <div className="banner danger">{err}</div>}
      {res && (
        <>
          <div className="card hero">
            <div className="tiny muted" style={{ marginBottom: 6 }}>{res.engine}</div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 16 }}>{res.text || "No plan returned."}</div>
            {res.stops.length > 0 && (
              <div className="row wrap" style={{ marginTop: 10 }}>
                {res.stops.map((x: any) => (
                  <button key={x.role} className="btn sm" onClick={() => show(x.stationId)}>{x.role === "eat" ? "🍜" : "📚"} {x.spot?.name} · {x.name}</button>
                ))}
              </div>
            )}
          </div>
          <h3>🛠️ Workflow steps ({res.steps.length})</h3>
          <div className="steps">
            {res.steps.map((st: any, i: number) => (
              <div key={i} className="step" onClick={() => setOpen(open === i ? null : i)} role="button">
                <div className="row between">
                  <b>{i + 1}. {TOOL_ICON[st.tool] ?? "🔧"} {st.tool}</b>
                  <span className="tiny muted">{st.ms} ms · {Array.isArray(st.output) ? `${st.output.length} results` : "result"}</span>
                </div>
                <div className="tiny muted mono">{JSON.stringify(st.input)}</div>
                {open === i && <pre>{JSON.stringify(st.output, null, 2)}</pre>}
              </div>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
