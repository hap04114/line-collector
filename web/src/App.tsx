import { useEffect } from "react";
import { fmtDist, haversine } from "./api";
import { useI18n } from "./i18n";
import { nearestStation, StoreProvider, useQuest, useStore, type Mode } from "./store";
import { StreetRunner } from "./views/StreetRunner";
import { FindView } from "./views/FindView";
import { FirstWeekView, Welcome, useFirstWeek } from "./views/FirstWeek";
import { ProofView } from "./views/ProofView";
import { api } from "./api";
import { MapView } from "./components/MapView";
import { StationSheet } from "./components/StationSheet";
import { CheckinFlow } from "./components/CheckinFlow";
import { Landing } from "./views/Landing";
import { BoardView } from "./views/BoardView";
import { PlanView } from "./views/PlanView";
import { MeView } from "./views/MeView";
import { LiveView } from "./views/LiveView";
import { RideView } from "./views/RideView";
import { FreeBostonView } from "./views/FreeBoston";

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const s = useStore();
  const { t, setLang, lang } = useI18n();

  // follow the student's saved language once signed in
  useEffect(() => {
    if (s.me?.user?.lang && s.me.user.lang !== lang) setLang(s.me.user.lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.me?.user?.lang]);

  useEffect(() => {
    if (!s.me || s.panel) return;
    let welcomed = false;
    try { welcomed = localStorage.getItem("lc-welcomed") === "1"; } catch { /* ignore */ }
    if (!welcomed && !s.me.user.homeRegions?.length) s.setPanel("welcome");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.me?.user?.id]);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get("spot");
    if (!id || !s.statics) return;
    api.get(`/spots/${id}`).then((r) => {
      s.openStation(r.spot.stationId);
      s.flyTo(r.spot.lat, r.spot.lon, 16.5);
      history.replaceState(null, "", "/");
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.statics]);

  if (!s.config) return <div className="signin"><div className="signin-wrap"><div className="logo">Line <i>Collector</i></div><p className="muted">Loading…</p></div></div>;
  if (!s.me && !s.signedOutBrowse) return <Landing />;

  return (
    <div className="app">
      <MapView />
      <TopBar />
      {s.stationId && !s.panel && <StationSheet key={s.stationId} />}
      {s.panel === "board" && <BoardView />}
      {s.panel === "plan" && <PlanView />}
      {s.panel === "me" && <MeView />}
      {s.panel === "live" && <LiveView />}
      {s.panel === "ride" && <RideView />}
      {s.panel === "find" && <FindView />}
      {s.panel === "week" && <FirstWeekView />}
      {s.panel === "proof" && <ProofView />}
      {s.panel === "free" && <FreeBostonView />}
      {s.panel === "welcome" && <Welcome onDone={() => s.setPanel("week")} />}
      {s.checkinSpot && <CheckinFlow />}
      {!s.panel && !s.stationId && !s.checkinSpot && s.me && <QuestCard />}
      <BottomNav />
      {s.panel === "run" && <StreetRunner onClose={() => s.setPanel(null)} />}
      {s.toastMsg && <div className="toast" role="status">{s.toastMsg}</div>}
      <span className="hidden">{t("map")}</span>
    </div>
  );
}

const LEVEL_ICON: Record<string, string> = { Newcomer: "🌱", Explorer: "🧭", Regular: "☕", Local: "🏠", Townie: "🦞" };

function Ring({ progress, color, label, title }: { progress: number; color: string; label: string; title?: string }) {
  const r = 20, c = 2 * Math.PI * r;
  return (
    <div className="ring" aria-label={title ?? label} title={title}>
      <svg width="46" height="46" viewBox="0 0 46 46">
        <circle cx="23" cy="23" r={r} stroke="#2b2e38" strokeWidth="5" fill="none" />
        <circle cx="23" cy="23" r={r} stroke={color} strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={`${c * Math.max(0.02, progress)} ${c}`} />
      </svg>
      <div className="lvl">{label}</div>
    </div>
  );
}

function TopBar() {
  const s = useStore();
  const { t } = useI18n();
  const me = s.me;
  const near = s.statics ? nearestStation(s.statics.stations, s.pos) : null;
  const campus = s.pos && s.config ? [...s.config.schools].map((c) => ({ c, d: haversine(s.pos!.lat, s.pos!.lon, c.lat, c.lon) })).sort((a, b) => a.d - b.d)[0] : null;
  const modes: { id: Mode; label: string; icon: string }[] = [
    { id: "explore", label: t("explore"), icon: "🍜" },
    { id: "study", label: t("study"), icon: "📚" },
    { id: "live", label: t("live"), icon: "🏠" },
    { id: "ride", label: t("ride"), icon: "🚇" },
  ];
  const streakText = me ? (me.streak.state === "safe" ? t("streakSafe") : me.streak.state === "skip" ? t("streakSkip") : me.streak.state === "due" ? t("streakDue") : "") : "";
  return (
    <div className="topbar">
      {me ? (
        <div className="status" onClick={() => s.setPanel("me")} role="button" title={streakText}>
          <Ring progress={me.level.progress} color={me.user.school.color} label={LEVEL_ICON[me.level.name] ?? "🌱"} title={`${me.level.name}: ${Math.round(me.level.progress * 100)}% to next level`} />
          <div className="stat"><b>{me.weekPoints.toLocaleString()}</b><span>{t("weekPoints")}</span></div>
          <div className="stat"><b>🔥 {me.streak.weeks}</b><span>{me.streak.state === "due" ? "due" : me.streak.state === "skip" ? "skip" : "wk"}</span></div>
          <div className="stat"><b>{me.stops.collected}</b><span>stops</span></div>
          <div className="grow" />
          <span className="tag" style={{ borderColor: me.user.school.color }}>
            <span className="school-dot" style={{ background: me.user.school.color }} /> {me.user.school.short}
          </span>
        </div>
      ) : (
        <div className="status">
          <div className="grow small">{t("signInToCollect")}</div>
          <button className="btn sm primary" onClick={() => s.setSignedOutBrowse(false)}>Sign in</button>
        </div>
      )}
      <div className="chips layer-chips" role="tablist">
        {modes.map((m) => (
          <button key={m.id} role="tab" aria-selected={s.mode === m.id} className={`chip accent ${s.mode === m.id ? "on" : ""}`}
            onClick={() => { s.setMode(m.id); if (m.id === "live") s.setPanel(s.panel === "live" ? null : "live"); else if (m.id === "ride") s.setPanel(s.panel === "ride" ? null : "ride"); else if (s.panel === "live" || s.panel === "ride") s.setPanel(null); }}>
            {m.icon} {m.label}
          </button>
        ))}
        <button className="chip accent free-chip" onClick={() => { s.openStation(null); s.setPanel(s.panel === "free" ? null : "free"); }}>💸 $0 Boston</button>
        <button className="chip accent run-chip" onClick={() => (s.me ? s.setPanel("run") : s.setSignedOutBrowse(false))}>🏃 Street Runner</button>
      </div>
      <button className="searchbar" onClick={() => { s.openStation(null); s.setPanel("find"); }}>🔍 <span>Find food or a study spot near you</span></button>
      {near && (
        <button className="nearest" onClick={() => { s.openStation(near.station.id); s.flyTo(near.station.lat, near.station.lon, 15.5); }}>
          📍 {t("nearest")}: <b>{near.station.name}</b> · {fmtDist(near.distanceM)}
          {campus && ` · ${t("campus")}: ${campus.d < 1500 ? campus.c.short : `${campus.c.short} ${fmtDist(campus.d)}`}`}
        </button>
      )}
      {!near && s.geoError && <div className="nearest muted">{s.geoError}</div>}
    </div>
  );
}

function BottomNav() {
  const s = useStore();
  const { t } = useI18n();
  const near = s.statics ? nearestStation(s.statics.stations, s.pos) : null;
  const go = (p: typeof s.panel) => {
    s.setPanel(s.panel === p ? null : p);
    if (p) s.openStation(null);
  };
  const onFab = () => {
    if (s.stationId) return; // sheet already open: spots carry their own check-in buttons
    const target = near?.station;
    const home = s.config?.schools.find((c) => c.id === s.me?.user?.school?.id)?.homeStations[0];
    const id = target?.id ?? home ?? "place-pktrm";
    const st = s.stationById.get(id);
    s.setPanel(null);
    s.openStation(id);
    if (st) s.flyTo(st.lat, st.lon, 15.5);
  };
  return (
    <nav className="bottomnav" aria-label="Main">
      <button className={`navbtn ${!s.panel ? "on" : ""}`} onClick={() => { s.setPanel(null); }}><span className="ico">🗺️</span>{t("map")}</button>
      <button className={`navbtn ${s.panel === "plan" ? "on" : ""}`} onClick={() => go("plan")}><span className="ico">✨</span>{t("plan")}</button>
      <button className="fab" onClick={onFab}>
        📸 {near && near.distanceM < 400 ? t("checkIn") : t("findStop")}
        {near && <small>{near.station.name}</small>}
      </button>
      <button className={`navbtn ${s.panel === "board" ? "on" : ""}`} onClick={() => go("board")}><span className="ico">🏆</span>{t("board")}</button>
      <button className={`navbtn ${s.panel === "me" ? "on" : ""}`} onClick={() => (s.me ? go("me") : s.setSignedOutBrowse(false))}><span className="ico">👤</span>{t("me")}</button>
    </nav>
  );
}

/** Game layer HUD: the next quest (best points per km) and this week's challenge. */
function QuestCard() {
  const s = useStore();
  const q = useQuest();
  const fw = useFirstWeek();
  const me = s.me;
  const goal = 3;
  const done = Math.min(goal, me?.weekStops ?? 0);
  if (!q) return null;
  const go = () => {
    s.openStation(q.station.id);
    s.flyTo(q.station.lat, q.station.lon, 15.5);
  };
  return (
    <div className="quest">
      {fw && fw.done < fw.total && (
        <button className="quest-week" style={{ cursor: "pointer", border: "1px solid #4a6a00" }} onClick={() => s.setPanel("week")}>
          <span className="tiny" style={{ fontWeight: 800 }}>🗓️ First Week in Boston</span>
          <div className="bar grow"><i style={{ width: `${(100 * fw.done) / fw.total}%`, background: "var(--accent)" }} /></div>
          <b className="tiny">{fw.done}/{fw.total} ›</b>
        </button>
      )}
      <div className="quest-main" onClick={go} role="button">
        <div className="quest-icon">🎯</div>
        <div className="grow">
          <div className="tiny muted" style={{ fontWeight: 700, letterSpacing: ".06em" }}>NEXT QUEST · {fmtDist(q.distanceM)}</div>
          <b>Collect {q.station.name}</b>
          <div className="tiny" style={{ color: "var(--accent)" }}>{q.reasons.slice(0, 3).join(" · ")}</div>
        </div>
        <div className="quest-pts">+{q.points}</div>
      </div>
      <div className="quest-week">
        <span className="tiny">⚡ Weekly: collect {goal} new stops</span>
        <div className="bar grow"><i style={{ width: `${(100 * done) / goal}%`, background: "var(--accent)" }} /></div>
        <b className="tiny">{done}/{goal}</b>
      </div>
    </div>
  );
}
