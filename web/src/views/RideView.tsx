import { useEffect, useState } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { LinePill, nearestStation, useStore } from "../store";
import { Sheet } from "../components/Sheet";

export function RideView() {
  const s = useStore();
  const { t } = useI18n();
  const [status, setStatus] = useState<any>(null);
  const [rides, setRides] = useState<any[]>([]);
  const [mine, setMine] = useState<any>(null);
  const [nudge, setNudge] = useState<any>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const near = nearestStation(s.statics?.stations ?? [], s.pos)?.station;
  const homeStation = s.config?.schools.find((c) => c.id === s.me?.user?.school?.id)?.homeStations[0];
  const [form, setForm] = useState(() => ({ fromStation: near?.id ?? homeStation ?? "place-pktrm", toArea: "", time: "", seats: 2, contact: s.me?.user?.contact ?? "", note: "" }));
  const [joinFor, setJoinFor] = useState<string | null>(null);
  const [joinContact, setJoinContact] = useState(s.me?.user?.contact ?? "");

  const load = () => {
    api.get("/lines/status").then(setStatus);
    if (s.me) {
      api.get("/rides").then((r) => setRides(r.rides));
      api.get("/rides/mine").then(setMine);
    }
  };
  useEffect(() => {
    load();
    api.get("/rides/areas").then((r) => setAreas(r.areas));
    const i = setInterval(() => api.get("/lines/status").then(setStatus), 30_000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const st = near?.id ?? homeStation;
    if (s.me && st) api.get(`/rides/nudge?station=${st}`).then(setNudge).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near?.id, s.me]);

  const post = async () => {
    try {
      const at = new Date();
      const [h, m] = form.time.split(":").map(Number);
      at.setHours(h, m, 0, 0);
      if (at.getTime() < Date.now() - 10 * 60_000) at.setDate(at.getDate() + 1);
      await api.post("/rides", { fromStation: form.fromStation, toArea: form.toArea, departAt: at.toISOString(), seats: Number(form.seats), contact: form.contact, note: form.note || undefined });
      s.toast("Ride posted for students from your school.");
      load();
    } catch (e) {
      s.toast((e as Error).message);
    }
  };
  const share = async (r: any) => {
    const text = `I'm splitting a ride from ${r.from} T station to ${r.toArea} at ${new Date(r.departAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} with ${r.poster} (${s.me?.user?.school?.short} student, via Charlie on the MTA).`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        s.toast("Trip details copied: send them to a friend.");
      }
    } catch {
      /* share cancelled */
    }
  };

  return (
    <Sheet title={`🚇 ${t("ride")}`} sub="Live T, chaos scores and late-night rides" onClose={() => { s.setPanel(null); s.setMode("explore"); }} full>
      {nudge?.message && <div className="banner warn">🌙 {nudge.message}</div>}
      <h3>{t("lineStatus")}</h3>
      {status?.weather && (
        <div className="small muted">
          🌡️ {Math.round(status.weather.tempF)}°F, feels like {Math.round(status.weather.feelsLikeF)}°F{status.weather.snowing && " · snowing"}
          {status.weather.warmUp && " · Warm-Up quests active: +30 indoors"}
        </div>
      )}
      <div className="list">
        {status?.lines.map((l: any) => (
          <div key={l.routeId} className="card tight">
            <div className="row between">
              <span className="row"><LinePill id={l.routeId} /><b>{l.name}</b>{l.shuttle && <span className="tag danger">🚌 {t("shuttle")} · x1.5</span>}</span>
              <b style={{ color: l.chaos >= 60 ? "var(--danger)" : l.chaos >= 30 ? "var(--warn)" : "var(--ok)" }}>{l.chaos}</b>
            </div>
            <div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${l.chaos}%`, background: l.chaos >= 60 ? "var(--danger)" : l.chaos >= 30 ? "var(--warn)" : "var(--ok)" }} /></div>
            <div className="tiny muted" style={{ marginTop: 4 }}>{l.vehicles} trains · {l.avgDelayS != null ? `avg ${Math.round(l.avgDelayS / 60)} min late` : "no delay data"} · {l.alertCount} alerts</div>
            {l.alerts.slice(0, 2).map((a: any) => <div key={a.id} className="tiny" style={{ marginTop: 3 }}>⚠️ {a.header}</div>)}
          </div>
        ))}
      </div>
      <div className="tiny muted">Chaos Score 0–100 from live delays, alert severity and shutdowns. Stops on chaotic lines earn a bonus; shutdown lines x1.5.</div>

      <div className="divider" />
      <h3>🚕 {t("rideSplit")}</h3>
      <div className="banner info small">🛡️ {t("rideSafety")}</div>
      {!s.me && <div className="small muted">{t("signInToCollect")}</div>}
      {s.me && (
        <>
          <div className="list">
            {rides.length === 0 && <div className="small muted">No rides from {s.me.user.school.short} students in the next few hours.</div>}
            {rides.map((r) => (
              <div key={r.id} className="card col">
                <div className="row between"><b>{r.from} → {r.toArea}</b><span>{new Date(r.departAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>
                <div className="small muted">{r.poster} · {r.seatsLeft} seat{r.seatsLeft === 1 ? "" : "s"} left{r.note && ` · ${r.note}`}</div>
                {r.contact ? (
                  <div className="banner ok small">Contact: <b>{r.contact}</b></div>
                ) : r.mine ? null : r.myRequest ? (
                  <span className="tag">Request {r.myRequest}</span>
                ) : joinFor === r.id ? (
                  <div className="row">
                    <input className="input" placeholder="Your contact" value={joinContact} onChange={(e) => setJoinContact(e.target.value)} />
                    <button className="btn primary" disabled={joinContact.length < 3} onClick={() => api.post(`/rides/${r.id}/join`, { contact: joinContact }).then(() => { setJoinFor(null); load(); s.toast("Request sent"); }).catch((e) => s.toast(e.message))}>{t("join")}</button>
                  </div>
                ) : (
                  <button className="btn" onClick={() => setJoinFor(r.id)}>{t("join")}</button>
                )}
                {!r.mine && (
                  <div className="row">
                    <button className="btn sm ghost" onClick={() => share(r)}>📤 {t("share")}</button>
                    <div className="grow" />
                    <button className="btn sm ghost" onClick={() => api.post(`/rides/${r.id}/report`).then(() => { s.toast("Reported and hidden"); load(); })}>⚑ {t("report")}</button>
                    <button className="btn sm ghost" onClick={() => api.post("/block", { rideId: r.id }).then(() => { s.toast("Blocked"); load(); })}>🚫 {t("block")}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {mine?.incoming?.length > 0 && (
            <>
              <h3>Requests for my rides</h3>
              {mine.incoming.map((q: any) => (
                <div key={q.id} className="card row between">
                  <span>{q.from} → {q.toArea} · {q.status}{q.contact && <> · <b>{q.contact}</b></>}</span>
                  {q.status === "pending" && (
                    <span className="row">
                      <button className="btn sm primary" onClick={() => api.post(`/ride-requests/${q.id}/accept`).then(load)}>{t("accept")}</button>
                      <button className="btn sm" onClick={() => api.post(`/ride-requests/${q.id}/decline`).then(load)}>{t("decline")}</button>
                    </span>
                  )}
                </div>
              ))}
            </>
          )}
          <div className="card col">
            <b>{t("postRide")}</b>
            <div className="field"><label>Pickup T station</label>
              <select className="input" value={form.fromStation} onChange={(e) => setForm({ ...form, fromStation: e.target.value })}>
                {[...(s.statics?.stations ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Heading to</label>
              <select className="input" value={form.toArea} onChange={(e) => setForm({ ...form, toArea: e.target.value })}>
                <option value="">Choose a neighborhood…</option>
                {areas.map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div className="row">
              <div className="field grow"><label>Leaving at</label><input className="input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></div>
              <div className="field grow"><label>Seats</label><input className="input" type="number" min={1} max={4} value={form.seats} onChange={(e) => setForm({ ...form, seats: Number(e.target.value) })} /></div>
            </div>
            <div className="field"><label>{t("contact")}</label><input className="input" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
            <button className="btn primary" disabled={!form.toArea || !form.time || form.contact.length < 3} onClick={post}>{t("postRide")}</button>
            <div className="tiny muted">Home addresses are never shared. Ride splits earn no points.</div>
          </div>
        </>
      )}
    </Sheet>
  );
}
