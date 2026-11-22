import { useEffect, useMemo, useState } from "react";
import { api, ApiError, fmtDist, money, qs, timeAgo } from "../api";
import { useI18n } from "../i18n";
import { LinePill, spotEmoji, useStore, type Mode } from "../store";
import { onSpotPinClick, showSpotPins } from "./MapView";
import { Sheet, Stepper } from "./Sheet";
import { BusyHeat, MenuReader } from "./SpotExtras";
import { FoodFilters, GetThere, SpotBadges, tfieldQuery, useTFieldPrefs, WhenPicker } from "./TFieldBits";

export function StationSheet() {
  const s = useStore();
  const { t } = useI18n();
  const st = s.stationById.get(s.stationId!)!;
  const [tab, setTab] = useState<Mode>(s.mode);
  const [info, setInfo] = useState<any>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api.get(`/stations/${st.id}`).then(setInfo).catch(() => {});
    return () => showSpotPins([]);
  }, [st.id]);
  useEffect(() => setTab(s.mode), [s.mode]);
  useEffect(() => {
    onSpotPinClick((id) => setSelected(id));
    return () => onSpotPinClick(null);
  }, []);

  const collected = s.mapState?.collected.includes(st.id);
  const nb = info?.neighborhood;
  return (
    <Sheet
      title={st.name}
      onClose={() => s.openStation(null)}
      sub={
        <span className="row wrap">
          {st.routes.map((r) => <LinePill key={r} id={r} />)}
          {nb && <span className="tag">{nb.icon} {nb.name}</span>}
          <span className={`tag ${collected ? "ok" : ""}`}>{collected ? `✓ ${t("collected")}` : t("notCollected")}</span>
        </span>
      }
    >
      <div className="seg" role="tablist">
        {(["explore", "study", "live", "ride"] as Mode[]).map((m) => (
          <button key={m} className={tab === m ? "on" : ""} onClick={() => setTab(m)} role="tab" aria-selected={tab === m}>
            {m === "explore" ? "🍜" : m === "study" ? "📚" : m === "live" ? "🏠" : "🚇"} {t(m)}
          </button>
        ))}
      </div>
      {info?.awayGame && <div className="banner warn">⚔️ {t("awayGame")} ({info.awayGame.school} turf)</div>}
      {info?.neutralGround && <div className="banner info">🔵 {t("neutralGround")}</div>}
      {info?.lines?.filter((l: any) => l.shuttle).map((l: any) => (
        <div key={l.routeId} className="banner danger">🚌 {l.name}: shuttle / shutdown active, so stops here get x1.5. {l.alerts[0]?.header}</div>
      ))}
      {tab === "explore" && <EatTab stationId={st.id} selected={selected} setSelected={setSelected} />}
      {tab === "study" && <StudyTab stationId={st.id} selected={selected} setSelected={setSelected} />}
      {tab === "live" && <LiveTab stationId={st.id} info={info} />}
      {tab === "ride" && <RideTab stationId={st.id} info={info} />}
      {nb && (
        <div className="card row" style={{ borderColor: nb.color }}>
          <div style={{ fontSize: 34 }}>{nb.icon}</div>
          <div className="grow">
            <b>{nb.name}</b> {s.mapState?.stamps.includes(nb.id) ? <span className="tag ok">stamp ✓</span> : <span className="tag">+150 new neighborhood</span>}
            <div className="small muted">{nb.blurb}</div>
          </div>
        </div>
      )}
      {info?.thisWeek?.length > 0 && (
        <div className="small muted">
          This week here:{" "}
          {info.thisWeek.slice(0, 4).map((w: any) => `${s.schoolById.get(w.school_id)?.short} ${w.n}`).join(" · ")}
        </div>
      )}
      <Tips stationId={st.id} />
    </Sheet>
  );
}

function SpotRow({ spot, selected, onClick }: { spot: any; selected: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button className={`spot ${selected ? "selected" : ""}`} onClick={onClick}>
      <div className="emoji">{spotEmoji(spot)}</div>
      <div className="grow">
        <div className="row wrap" style={{ gap: 6 }}>
          <b>{spot.name}</b>
          {spot.partner && <span className="tag gold">⭐ {t("localPartner")}</span>}
          {spot.visitedByMe && <span className="tag ok">✓</span>}
        </div>
        <div className="small muted">
          {spot.walkMin} {t("walk")}
          {spot.openNow === true && " · open now"}
          {spot.openNow === false && " · closed now"}
          {spot.openNow == null && spot.kind === "food" && " · hours unknown"}
          {spot.nextChange && ` · ${spot.nextChange}`}
          {spot.localOwned && spot.kind === "food" && " · local"}
        </div>
        {(spot.vibes?.length > 0 || spot.diet?.length > 0) && (
          <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
            {spot.diet?.map((d: string) => <span key={d} className="tag ok" title={d.endsWith("?") ? "inferred from the menu type" : "tagged on OpenStreetMap"}>🥗 {d.replace("?", "").replace("_", "-")}{d.endsWith("?") ? "?" : ""}</span>)}
            {spot.vibes?.map((v: string) => <span key={v} className="tag">{v}</span>)}
          </div>
        )}
        <SpotBadges spot={spot} />
      </div>
      <div className="price">
        {spot.kind === "food" ? money(spot.priceCents) : "free"}
        {spot.priceSource === "estimate" && <div className="tiny muted" style={{ fontWeight: 600 }}>{t("estimate")}</div>}
      </div>
    </button>
  );
}

function SpotDetail({ spotId }: { spotId: string }) {
  const s = useStore();
  const { t } = useI18n();
  const [d, setD] = useState<any>(null);
  const [rating, setRating] = useState({ outlets: 3, noise: 3, wifi: 3 });
  const [rev, setRev] = useState(0);
  useEffect(() => {
    api.get(`/spots/${spotId}`).then(setD).catch(() => {});
  }, [spotId, rev]);
  if (!d) return null;
  const sp = d.spot;
  const rate = async () => {
    try {
      await api.post(`/study/${sp.id}/rate`, rating);
      s.toast("Thanks! Rating saved.");
    } catch (e) {
      s.toast((e as Error).message);
    }
  };
  return (
    <div className="card col" style={{ borderColor: "var(--accent)" }}>
      {sp.description && <div className="small">{sp.description}</div>}
      <div className="small muted">
        {sp.cuisines?.length > 0 && <>{sp.cuisines.join(", ").replace(/_/g, " ")} · </>}
        {sp.address ?? ""} {sp.hours && <><br />Hours: <span className="mono tiny">{sp.hours}</span></>}
      </div>
      {sp.priceSource === "estimate" && sp.kind === "food" && <div className="tiny muted">Price is an estimate from the type of place, not a checked menu price.</div>}
      {sp.priceSource === "menu" && <div className="tiny" style={{ color: "var(--ok)" }}>✓ Price from a menu photo a student shared{sp.cheapestItem ? `: cheapest is ${sp.cheapestItem}` : ""}</div>}
      {sp.kind === "food" && <MenuReader spotId={sp.id} onUpdated={() => setRev(rev + 1)} />}
      <GetThere spot={sp} />
      <BusyHeat spotId={sp.id} />
      {d.stamp && (
        <div className="banner" style={{ borderColor: "#ffd16666" }}>
          <div className="row between"><b>⭐ {d.stamp.offer}</b>{d.stamp.isSample && <span className="tag warn">{t("sampleOffer")}</span>}</div>
          <div style={{ fontSize: 22, letterSpacing: 4, margin: "6px 0" }}>
            {Array.from({ length: d.stamp.needed }, (_, i) => (i < d.stamp.stamps ? "🟡" : "⚪")).join("")}
          </div>
          <div className="tiny muted">Each check-in here adds a stamp. Stamps never lower your points.</div>
        </div>
      )}
      {sp.study_rating && <div className="small">🔌 {sp.study_rating.outlets}/5 · 🤫 {sp.study_rating.noise}/5 quiet · 📶 {sp.study_rating.wifi}/5 <span className="muted">({sp.study_rating.n} ratings)</span></div>}
      {sp.visitedByMe && (sp.study || sp.kind === "study") && (
        <div className="col">
          <b className="small">Rate this study spot</b>
          {(["outlets", "noise", "wifi"] as const).map((k) => (
            <div key={k} className="row between small">
              <span>{k === "noise" ? "Quiet" : k[0].toUpperCase() + k.slice(1)}</span>
              <Stepper value={rating[k]} min={1} max={5} step={1} format={(v) => `${v}/5`} onChange={(v) => setRating({ ...rating, [k]: v })} />
            </div>
          ))}
          <button className="btn sm" onClick={rate}>Save rating</button>
        </div>
      )}
      <div className="row">
        {sp.website && <a className="btn sm ghost" href={sp.website} target="_blank" rel="noreferrer">Website</a>}
        <a className="btn sm ghost" href={`https://www.openstreetmap.org/?mlat=${sp.lat}&mlon=${sp.lon}#map=19/${sp.lat}/${sp.lon}`} target="_blank" rel="noreferrer">Map</a>
        <div className="grow" />
        <button className="btn primary" onClick={() => (s.me ? s.setCheckinSpot(sp) : s.setSignedOutBrowse(false))}>📸 {t("checkInHere")}</button>
      </div>
    </div>
  );
}

function EatTab({ stationId, selected, setSelected }: { stationId: string; selected: string | null; setSelected: (id: string | null) => void }) {
  const s = useStore();
  const { t } = useI18n();
  const [budget, setBudget] = useState<number>(Math.round((s.me?.user?.budgetCents ?? 1000) / 100));
  const [craving, setCraving] = useState<string>("");
  const [vibe, setVibe] = useState<string>("");
  const [openNow, setOpenNow] = useState(false);
  const [openLate, setOpenLate] = useState(false);
  const [limit, setLimit] = useState(3);
  const [res, setRes] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const tf = useTFieldPrefs();
  const tfq = tfieldQuery(tf.prefs);

  useEffect(() => {
    setLoading(true);
    api
      .get(`/spots?${qs({ stop: stationId, budget, craving, vibe, openNow, openLate, limit, ...tfq })}`)
      .then((r) => {
        setRes(r);
        showSpotPins([...r.food, ...r.landmarks].map((x: any) => ({ id: x.id, name: x.name, lat: x.lat, lon: x.lon, partner: !!x.partner, kind: x.kind })), selected);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId, budget, craving, vibe, openNow, openLate, limit, tfq.avoid, tfq.venue, tfq.showClosed, tfq.arriveIn]);
  useEffect(() => {
    if (res) showSpotPins([...res.food, ...res.landmarks].map((x: any) => ({ id: x.id, name: x.name, lat: x.lat, lon: x.lon, partner: !!x.partner, kind: x.kind })), selected);
  }, [selected, res]);

  const cravings = useMemo(() => [...(s.me?.user?.homeRegions?.length ? [{ id: "home", label: `🏠 ${t("tasteOfHome")}` }] : []), ...(s.statics?.cravings ?? [])], [s.me, s.statics, t]);
  const go = (id: string) => {
    const st = s.stationById.get(id);
    s.openStation(id);
    if (st) s.flyTo(st.lat, st.lon, 15.5);
  };

  return (
    <>
      <div className="row between">
        <span className="small muted">{t("budget")}</span>
        <Stepper value={budget} min={5} max={30} step={1} format={(v) => `$${v}`} onChange={setBudget} />
      </div>
      <div className="chips">
        {cravings.map((c) => (
          <button key={c.id} className={`chip ${craving === c.id ? "on" : ""}`} onClick={() => setCraving(craving === c.id ? "" : c.id)}>{c.label}</button>
        ))}
      </div>
      <div className="chips">
        <button className={`chip ${openNow ? "on" : ""}`} onClick={() => setOpenNow(!openNow)}>🕒 {t("openNow")}</button>
        <button className={`chip ${openLate ? "on" : ""}`} onClick={() => setOpenLate(!openLate)}>🌙 {t("openLate")}</button>
        {(s.statics?.vibes ?? []).slice(0, 4).map((v) => (
          <button key={v} className={`chip ${vibe === v ? "on" : ""}`} onClick={() => setVibe(vibe === v ? "" : v)}>{v}</button>
        ))}
      </div>
      <WhenPicker />
      <FoodFilters />
      <div className="list" aria-busy={loading}>
        {res?.food.map((sp: any) => (
          <div key={sp.id} className="col" style={{ gap: 8 }}>
            <SpotRow spot={sp} selected={selected === sp.id} onClick={() => setSelected(selected === sp.id ? null : sp.id)} />
            {selected === sp.id && <SpotDetail spotId={sp.id} />}
          </div>
        ))}
        {res && !res.food.length && (
          <div className="banner">
            {t("noSpots")}
            {res.suggestion && (
              <div style={{ marginTop: 8 }}>
                {t("tryStation")}{" "}
                <button className="btn sm" onClick={() => go(res.suggestion.stationId)}>{res.suggestion.name} · {fmtDist(res.suggestion.distanceM)}</button>
              </div>
            )}
          </div>
        )}
        {res?.moreFood > 0 && <button className="btn ghost" onClick={() => setLimit(limit + 5)}>+{res.moreFood} more under ${budget}</button>}
      </div>
      {res?.landmarks?.length > 0 && (
        <>
          <h3>🌳 {t("freeHangouts")}</h3>
          <div className="list">
            {res.landmarks.map((sp: any) => (
              <div key={sp.id} className="col" style={{ gap: 8 }}>
                <SpotRow spot={sp} selected={selected === sp.id} onClick={() => setSelected(selected === sp.id ? null : sp.id)} />
                {selected === sp.id && <SpotDetail spotId={sp.id} />}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function StudyTab({ stationId, selected, setSelected }: { stationId: string; selected: string | null; setSelected: (id: string | null) => void }) {
  const { t } = useI18n();
  const [openLate, setOpenLate] = useState(false);
  const [res, setRes] = useState<any>(null);
  useEffect(() => {
    api.get(`/spots?${qs({ stop: stationId, openLate })}`).then((r) => {
      setRes(r);
      showSpotPins(r.study.map((x: any) => ({ id: x.id, name: x.name, lat: x.lat, lon: x.lon, partner: false, kind: "study" })), selected);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId, openLate]);
  return (
    <>
      <div className="row between">
        <h3>📚 {t("studySpots")}</h3>
        <button className={`chip ${openLate ? "on" : ""}`} onClick={() => setOpenLate(!openLate)}>🌙 Late night</button>
      </div>
      <div className="tiny muted">Libraries and cafés with wifi from OpenStreetMap. Outlets and noise come from student ratings. A study check-in earns +50 and collects the stop.</div>
      <div className="list">
        {res?.study.map((sp: any) => (
          <div key={sp.id} className="col" style={{ gap: 8 }}>
            <SpotRow spot={{ ...sp, kind: sp.kind === "food" ? "study" : sp.kind }} selected={selected === sp.id} onClick={() => setSelected(selected === sp.id ? null : sp.id)} />
            {selected === sp.id && <SpotDetail spotId={sp.id} />}
          </div>
        ))}
        {res && !res.study.length && <div className="banner">No study spots mapped within a few minutes of this stop.</div>}
      </div>
    </>
  );
}

function LiveTab({ stationId, info }: { stationId: string; info: any }) {
  const s = useStore();
  const { t } = useI18n();
  const [sublets, setSublets] = useState<any[] | null>(null);
  useEffect(() => {
    if (s.me) api.get("/sublets").then((r) => setSublets(r.sublets.filter((x: any) => x.stationId === stationId))).catch(() => setSublets([]));
  }, [stationId, s.me]);
  const rent = info?.rent;
  return (
    <>
      <div className="card">
        <h3>🏠 {t("rent")}</h3>
        {rent?.median ? (
          <div className="row wrap" style={{ marginTop: 8 }}>
            {Object.entries(rent.median).map(([k, v]: any) => (
              <span key={k} className="tag">{k === "0" ? "Studio" : k === "all" ? "All" : `${k}BR`}: ${Math.round(v).toLocaleString()}</span>
            ))}
            <div className="tiny muted" style={{ width: "100%" }}>RentCast market data for {rent.zip}, cached {String(rent.fetchedAt).slice(0, 10)}.</div>
          </div>
        ) : (
          <div className="small muted" style={{ marginTop: 6 }}>{t("noRent")} {rent?.zip && `(ZIP ${rent.zip})`}</div>
        )}
      </div>
      <button className="btn block" onClick={() => s.setPanel("live")}>🔎 {t("listingCheck")} · {t("sublets")}</button>
      {sublets && sublets.length > 0 && (
        <div className="list">
          <h3>Verified sublets near here</h3>
          {sublets.map((x) => (
            <div key={x.id} className="card tight">
              <b>{x.title}</b> · ${x.price}/mo
              <div className="row wrap" style={{ marginTop: 4 }}>{x.badges.map((b: string) => <span key={b} className="tag ok">✓ {b}</span>)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RideTab({ stationId, info }: { stationId: string; info: any }) {
  const s = useStore();
  const { t } = useI18n();
  const [nudge, setNudge] = useState<any>(null);
  useEffect(() => {
    if (s.me) api.get(`/rides/nudge?station=${stationId}`).then(setNudge).catch(() => {});
  }, [stationId, s.me]);
  return (
    <>
      <div className="list">
        {info?.lines?.map((l: any) => (
          <div key={l.routeId} className="card tight">
            <div className="row between">
              <span className="row"><LinePill id={l.routeId} /> <b>{l.name}</b></span>
              <span className={`tag ${l.chaos >= 60 ? "danger" : l.chaos >= 30 ? "warn" : "ok"}`}>{t("chaos")} {l.chaos}</span>
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              {l.vehicles} trains running{l.avgDelayS != null && ` · avg ${Math.round(l.avgDelayS / 60)} min late`}
            </div>
            {l.alerts.slice(0, 2).map((a: any) => <div key={a.id} className="tiny" style={{ marginTop: 4 }}>⚠️ {a.header}</div>)}
          </div>
        ))}
      </div>
      {nudge?.message && <div className="banner warn">🌙 {nudge.message}</div>}
      {nudge?.lastTrains?.length > 0 && (
        <div className="small muted">
          Last trains today: {nudge.lastTrains.slice(0, 4).map((l: any) => `${s.routeById.get(l.routeId)?.short} → ${l.headsign} ${new Date(l.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`).join(" · ")}
        </div>
      )}
      <button className="btn block" onClick={() => s.setPanel("ride")}>🚕 {t("rideSplit")}</button>
    </>
  );
}

function Tips({ stationId }: { stationId: string }) {
  const s = useStore();
  const { t } = useI18n();
  const [d, setD] = useState<any>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.get(`/tips?stop=${stationId}`).then(setD).catch(() => {});
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId]);
  const post = async () => {
    setErr(null);
    try {
      await api.post("/tips", { stationId, text });
      setText("");
      load();
      s.toast("Tip posted. You earn points when students mark it helpful.");
    } catch (e) {
      setErr((e as ApiError).message);
    }
  };
  return (
    <div className="col">
      <h3>💬 {t("localTips")}</h3>
      {d?.tips?.length ? (
        d.tips.map((tip: any) => (
          <div key={tip.id} className="card tight">
            <div>{tip.text}</div>
            <div className="row between tiny muted" style={{ marginTop: 6 }}>
              <span>{tip.author} · {tip.school} · {timeAgo(tip.at)}</span>
              <span className="row">
                {!tip.mine && s.me && (
                  <button className="btn sm ghost" disabled={tip.voted} onClick={() => api.post(`/tips/${tip.id}/helpful`).then(load)}>👍 {tip.helpful}</button>
                )}
                {(tip.mine || !s.me) && <span>👍 {tip.helpful}</span>}
                {!tip.mine && s.me && <button className="btn sm ghost" onClick={() => api.post(`/tips/${tip.id}/report`).then(() => { s.toast("Reported. The tip is hidden until reviewed."); load(); })}>⚑</button>}
              </span>
            </div>
          </div>
        ))
      ) : (
        <div className="small muted">No tips yet. Collect this stop and be the first.</div>
      )}
      {d?.canPost && !d?.mine && (
        <div className="col">
          <textarea className="input" style={{ minHeight: 70 }} maxLength={280} placeholder={`${t("leaveTip")}: which exit, what to order, where to sit…`} value={text} onChange={(e) => setText(e.target.value)} />
          {err && <div className="error">{err}</div>}
          <button className="btn sm" disabled={text.trim().length < 8} onClick={post}>Post tip</button>
        </div>
      )}
    </div>
  );
}
