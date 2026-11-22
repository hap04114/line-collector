import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { LinePill, useStore } from "../store";
import { BarChart, hourLabel, Sheet } from "../components/Sheet";

export function BoardView() {
  const s = useStore();
  const { t } = useI18n();
  const [tab, setTab] = useState<"schools" | "school" | "friends">("schools");
  const [view, setView] = useState<"average" | "stops">("average");
  const [board, setBoard] = useState<any>(null);
  const [timeline, setTimeline] = useState<any>(null);
  const [players, setPlayers] = useState<any>(null);
  const [line, setLine] = useState("Green-B");
  const [rel, setRel] = useState<any>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    api.get(`/leaderboard/schools?view=${view}`).then(setBoard);
  }, [view]);
  useEffect(() => {
    api.get("/leaderboard/schools/timeline").then(setTimeline);
  }, []);
  useEffect(() => {
    if (tab !== "schools" && s.me) api.get(`/leaderboard/players?scope=${tab === "friends" ? "friends" : "school"}`).then(setPlayers);
  }, [tab, s.me]);
  useEffect(() => {
    api.get(`/lines/${line}/reliability?days=14`).then(setRel).catch(() => setRel(null));
  }, [line]);

  const resets = board ? Math.max(0, Math.round((new Date(board.resetsAt).getTime() - Date.now()) / 3600_000)) : null;
  const addFriend = async () => {
    try {
      const r = await api.post("/friends", { code });
      s.toast(`Added ${r.friend.name}`);
      setCode("");
      api.get("/leaderboard/players?scope=friends").then(setPlayers);
    } catch (e) {
      s.toast((e as Error).message);
    }
  };

  return (
    <Sheet title={`🏆 ${t("schoolBoard")}`} sub={resets != null ? `${t("resetsMonday")} · ${Math.floor(resets / 24)}d ${resets % 24}h left` : undefined} onClose={() => s.setPanel(null)} full>
      <div className="seg">
        <button className={tab === "schools" ? "on" : ""} onClick={() => setTab("schools")}>Schools</button>
        <button className={tab === "school" ? "on" : ""} onClick={() => setTab("school")} disabled={!s.me}>{t("mySchool")}</button>
        <button className={tab === "friends" ? "on" : ""} onClick={() => setTab("friends")} disabled={!s.me}>{t("friends")}</button>
      </div>

      {tab === "schools" && board && (
        <>
          <div className="chips">
            <button className={`chip ${view === "average" ? "on" : ""}`} onClick={() => setView("average")}>{t("avgPerPlayer")}</button>
            <button className={`chip ${view === "stops" ? "on" : ""}`} onClick={() => setView("stops")}>{t("totalStops")}</button>
          </div>
          <div className="list">
            {board.board.map((r: any, i: number) => (
              <div key={r.school.id} className={`board-row ${s.me?.user?.school?.id === r.school.id ? "me" : ""}`}>
                <div className="rank">{r.eligible ? i + 1 : "–"}</div>
                <div>
                  <div className="row"><span className="school-dot" style={{ background: r.school.color }} /><b>{r.school.short}</b></div>
                  <div className="bar" style={{ marginTop: 6 }}>
                    <i style={{ width: `${(100 * (view === "stops" ? r.stops : r.avgPoints)) / Math.max(1, ...board.board.map((b: any) => (view === "stops" ? b.stops : b.avgPoints)))}%`, background: r.school.color }} />
                  </div>
                  <div className="tiny muted" style={{ marginTop: 4 }}>
                    {r.activePlayers} active · {r.totalPoints.toLocaleString()} pts · {r.stops} stops
                    {!r.eligible && ` · ${t("needsPlayers")}`}
                  </div>
                </div>
                <b style={{ fontSize: 20 }}>{view === "stops" ? r.stops : Math.round(r.avgPoints)}</b>
              </div>
            ))}
          </div>
          <div className="tiny muted">
            Ranked by average points per active player (min {board.minPlayers}), so big schools don't win by size. {t("demoNote")} Source: {board.source}.{" "}
            <button className="btn sm ghost" onClick={() => s.setPanel("proof")}>🔧 How it's built</button>
          </div>
          {timeline && <Timeline data={timeline} />}
        </>
      )}

      {tab !== "schools" && players && (
        <div className="list">
          {players.players.map((p: any, i: number) => (
            <div key={p.id} className={`board-row ${p.me ? "me" : ""}`}>
              <div className="rank">{i + 1}</div>
              <div><b>{p.name}</b><div className="tiny muted">{s.schoolById.get(p.school)?.short} · {p.stops ?? 0} new stops</div></div>
              <b>{p.points ?? 0}</b>
            </div>
          ))}
          {tab === "friends" && (
            <div className="card col">
              <div className="small">{t("friendCode")}: <b className="mono" style={{ fontSize: 18 }}>{s.me?.user?.friendCode}</b></div>
              <div className="row">
                <input className="input" placeholder={t("addFriend")} value={code} maxLength={8} onChange={(e) => setCode(e.target.value.toUpperCase())} />
                <button className="btn" disabled={code.length < 4} onClick={addFriend}>Add</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="divider" />
      <h3>🚇 {t("lineReliability")}</h3>
      <div className="chips">
        {(s.statics?.routes ?? []).map((r) => (
          <button key={r.id} className={`chip ${line === r.id ? "on" : ""}`} onClick={() => setLine(r.id)}><LinePill id={r.id} /> {r.short}</button>
        ))}
      </div>
      {rel && (
        <>
          {rel.honest && <div className="banner warn">⏱️ {rel.honest}</div>}
          {rel.byHour.length ? (
            <BarChart data={rel.byHour.map((h: any) => ({ x: hourLabel(h.hour), y: Math.round((h.avg_delay_s ?? 0) / 6) / 10 }))} color={s.routeById.get(line)?.color} label={(y) => `${y} min late on average`} />
          ) : (
            <div className="small muted">No delay history yet. The poller saves predictions every 30 s; this fills in as it runs.</div>
          )}
          <div className="tiny muted">Avg minutes late by hour of day · {rel.samples} samples since {rel.dataSince ? new Date(rel.dataSince).toLocaleString() : "now"} · {rel.source}</div>
        </>
      )}
    </Sheet>
  );
}

function Timeline({ data }: { data: { weekStart: string; rows: { hour: string; school_id: string; points: number }[] } }) {
  const s = useStore();
  const series = useMemo(() => {
    const start = new Date(data.weekStart).getTime();
    const hours = Math.max(1, Math.ceil((Date.now() - start) / 3600_000));
    const by = new Map<string, number[]>();
    for (const r of data.rows) {
      const idx = Math.min(hours - 1, Math.max(0, Math.floor((new Date(r.hour).getTime() - start) / 3600_000)));
      const arr = by.get(r.school_id) ?? new Array(hours).fill(0);
      arr[idx] += r.points;
      by.set(r.school_id, arr);
    }
    const out: { id: string; pts: number[] }[] = [];
    for (const [id, arr] of by) {
      let c = 0;
      out.push({ id, pts: arr.map((v) => (c += v)) });
    }
    return { hours, out };
  }, [data]);
  const max = Math.max(1, ...series.out.map((x) => x.pts[x.pts.length - 1] ?? 0));
  const W = 320, H = 130;
  const [upto, setUpto] = useState(series.hours);
  const replay = () => {
    let i = 0;
    const t = setInterval(() => {
      i += Math.max(1, Math.round(series.hours / 60));
      setUpto(Math.min(i, series.hours));
      if (i >= series.hours) clearInterval(t);
    }, 50);
  };
  const leader = series.out.map((x) => ({ id: x.id, v: x.pts[Math.max(0, upto - 1)] ?? 0 })).sort((a, b) => b.v - a.v)[0];
  return (
    <div className="card">
      <div className="row between">
        <b className="small">The race this week (cumulative points)</b>
        <button className="btn sm" onClick={replay}>▶ Replay</button>
      </div>
      {upto < series.hours && leader && <div className="tiny">Leader: <b style={{ color: s.schoolById.get(leader.id)?.color }}>{s.schoolById.get(leader.id)?.short}</b> · {Math.round((upto / 24) * 10) / 10} days in</div>}
      <svg className="chart" viewBox={`0 0 ${W} ${H + 16}`}>
        {series.out.map((x) => (
          <polyline key={x.id} fill="none" stroke={s.schoolById.get(x.id)?.color} strokeWidth={2.2}
            points={x.pts.slice(0, Math.max(1, upto)).map((v, i) => `${(i / Math.max(1, series.hours - 1)) * W},${H - (v / max) * H}`).join(" ")} />
        ))}
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
          <text key={d} x={(i * 24 / Math.max(1, series.hours - 1)) * W} y={H + 13} fontSize="9" fill="#b4b8c4">{i * 24 < series.hours ? d : ""}</text>
        ))}
      </svg>
    </div>
  );
}
