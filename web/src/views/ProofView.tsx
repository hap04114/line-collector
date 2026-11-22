import { useEffect, useState } from "react";
import { api, timeAgo } from "../api";
import { useStore } from "../store";
import { Sheet } from "../components/Sheet";

/** How it's built: live proof of each sponsor integration, straight from the running server. */
export function ProofView() {
  const s = useStore();
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    const load = () => api.get("/proof").then(setD).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  const Row = ({ k, v }: { k: string; v: any }) => <div className="row between small"><span className="muted">{k}</span><b style={{ textAlign: "right" }}>{v ?? "—"}</b></div>;
  const ok = (b: boolean) => <span className={`tag ${b ? "ok" : "warn"}`}>{b ? "live" : "not configured"}</span>;
  return (
    <Sheet title="🔧 How it's built" sub="Live from the running server, refreshing every 5 s" onClose={() => s.setPanel(null)} full>
      {!d ? <div className="muted">Loading…</div> : (
        <>
          <div className="card col">
            <div className="row between"><h3>🐯 Tiger Data</h3>{ok(d.database.engine.startsWith("Tiger"))}</div>
            <Row k="Engine" v={d.database.engine} />
            <Row k="Hypertables" v={d.database.hypertables.join(", ") || "—"} />
            <Row k="Continuous aggregates" v={d.database.continuousAggregates.join(", ") || "—"} />
            <Row k="pgvector (search by meaning)" v={d.database.pgvector ? "on" : "off"} />
            {Object.entries(d.database.rows).map(([k, v]) => <Row key={k} k={`rows · ${k}`} v={(v as number)?.toLocaleString()} />)}
            <Row k="Last line metric saved" v={d.database.lastLineMetric ? timeAgo(d.database.lastLineMetric) : null} />
          </div>
          <div className="card col">
            <div className="row between"><h3>✨ Gemini</h3>{ok(d.gemini.enabled)}</div>
            <Row k="Model" v={d.gemini.model} />
            <Row k="Embeddings" v={d.gemini.embedModel} />
            <div className="row wrap">{d.gemini.uses.map((u: string) => <span key={u} className="tag">{u}</span>)}</div>
          </div>
          <div className="card col">
            <div className="row between"><h3>🤖 Mastra workflow</h3>{ok(d.mastra.lastRuns.length > 0)}</div>
            {d.mastra.lastRuns.length === 0 && <div className="small muted">Run the Stop Planner to see its steps here.</div>}
            {d.mastra.lastRuns.slice(0, 1).map((r: any) => (
              <div key={r.at} className="col" style={{ gap: 4 }}>
                <div className="small">“{r.query}” · {timeAgo(r.at)}</div>
                <div className="tiny muted">{r.engine}</div>
                <div className="row wrap">{r.steps.map((st: any, i: number) => <span key={i} className="tag">{i + 1}. {st.tool} · {st.ms} ms</span>)}</div>
              </div>
            ))}
          </div>
          <div className="card col">
            <div className="row between"><h3>☁️ Vultr</h3>{ok(d.storage.provider.startsWith("Vultr"))}</div>
            <Row k="Object storage" v={d.storage.provider} />
            <Row k="Objects written since start" v={d.storage.puts} />
            <Row k="Last object" v={d.storage.lastKey} />
            <Row k="Last backup" v={d.storage.lastBackup ? timeAgo(d.storage.lastBackup) : null} />
            <Row k="Live MBTA poller" v={`${d.mbta.vehicles} trains · ${d.mbta.alerts} alerts${d.mbta.vehiclesAt ? ` · ${timeAgo(d.mbta.vehiclesAt)}` : ""}`} />
            <Row k="Domain" v={d.domain} />
          </div>
          <div className="card col">
            <div className="row between"><h3>◎ Solana devnet</h3>{ok(d.solana.enabled)}</div>
            <Row k="Rewards redeemed" v={d.solana.redemptions} />
            <Row k="On-chain receipts" v={d.solana.receipts} />
            {d.solana.recent.map((r: any) => <a key={r.sig} className="tiny" href={r.url} target="_blank" rel="noreferrer">{r.sig.slice(0, 20)}… ↗</a>)}
          </div>
        </>
      )}
    </Sheet>
  );
}
