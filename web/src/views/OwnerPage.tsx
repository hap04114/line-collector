import { useEffect, useState } from "react";
import { api } from "../api";
import { BarChart, hourLabel } from "../components/Sheet";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Simple owner page: confirm codes, create an offer, set stamps and slow hours, see visits by hour. */
export function OwnerPage() {
  const [me, setMe] = useState<any>(undefined);
  const [cfg, setCfg] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<any>(null);
  const load = () => api.get("/partners/me").then(setMe).catch(() => setMe(null));
  useEffect(() => {
    load();
    api.get("/config").then(setCfg);
  }, []);

  if (me === undefined) return <div className="signin"><div className="signin-wrap">Loading…</div></div>;
  if (!me)
    return (
      <div className="signin">
        <div className="signin-wrap">
          <div className="logo">Line <i>Collector</i> · owners</div>
          <p>Bring students in during your slow hours with a free digital punch card. No new equipment: students show a 6-digit code, you type it here.</p>
          <div className="card col">
            <div className="field"><label>Email on your partner account</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <button className="btn primary" onClick={() => api.post("/auth/owner-start", { email }).then(setSent)}>Send sign-in link</button>
            {sent && <div className="banner ok small">If that email belongs to a partner, a sign-in link is on its way.{sent.devLink && <> Dev link: <a href={sent.devLink}>open</a></>}</div>}
          </div>
          {cfg?.demoMode && (
            <button className="btn" onClick={() => api.post("/auth/demo", { owner: true }).then(load)}>Open the sample owner page (demo)</button>
          )}
          <a className="btn ghost" href="/">← Student app</a>
        </div>
      </div>
    );
  return <Dashboard me={me} reload={load} />;
}

function Dashboard({ me, reload }: { me: any; reload: () => void }) {
  const [stats, setStats] = useState<any>(null);
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState<{ ok: boolean; text: string } | null>(null);
  const offer = me.offers[0];
  const [o, setO] = useState(() => ({
    id: offer?.id as string | undefined,
    title: offer?.title ?? "Free drink with any meal",
    stampsNeeded: offer?.stamps_needed ?? 5,
    active: offer?.active ?? true,
    slow: !!offer?.slow_hours,
    days: (offer?.slow_hours?.days ?? [1, 2, 3, 4, 5]) as number[],
    startHour: offer?.slow_hours?.startHour ?? 14,
    endHour: offer?.slow_hours?.endHour ?? 17,
    multiplier: offer?.slow_hours?.multiplier ?? 2,
  }));
  useEffect(() => {
    api.get("/partners/stats").then(setStats);
  }, []);

  const doConfirm = async () => {
    try {
      const r = await api.post("/partners/confirm", { code });
      setConfirm({ ok: true, text: `✓ Redeemed: ${r.reward} for ${r.student}` });
      setCode("");
      api.get("/partners/stats").then(setStats);
    } catch (e) {
      setConfirm({ ok: false, text: (e as Error).message });
    }
  };
  const saveOffer = async () => {
    await api.post("/partners/offers", {
      id: o.id, title: o.title, stampsNeeded: Number(o.stampsNeeded), active: o.active,
      slowHours: o.slow ? { days: o.days, startHour: Number(o.startHour), endHour: Number(o.endHour), multiplier: Number(o.multiplier) } : null,
    });
    reload();
    setConfirm({ ok: true, text: "Offer saved. Slow-hour bonus is live on the map." });
  };

  const hours = Array.from({ length: 24 }, (_, h) => ({ x: hourLabel(h), y: stats?.byHour.find((b: any) => b.hour === h)?.visits ?? 0 }));
  return (
    <div className="signin">
      <div className="signin-wrap">
        <div className="row between">
          <div><div className="logo" style={{ fontSize: 22 }}>{me.partner.name}</div><div className="small muted">{me.partner.station} · {me.partner.ownerName}</div></div>
          <button className="btn sm ghost" onClick={() => api.post("/auth/logout").then(() => location.reload())}>Sign out</button>
        </div>
        {me.partner.isSample && <div className="banner warn small">Sample partner for the demo. This business has not agreed to a partnership; offers here are examples only.</div>}

        <div className="card col">
          <b>Confirm a student's code</b>
          <input className="input mono" style={{ fontSize: 30, letterSpacing: 8, textAlign: "center" }} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" />
          <button className="btn primary" disabled={code.length !== 6} onClick={doConfirm}>Confirm</button>
          {confirm && <div className={`banner ${confirm.ok ? "ok" : "danger"}`}>{confirm.text}</div>}
          <div className="tiny muted">Codes expire 2 minutes after the student taps Redeem and work once.</div>
        </div>

        <div className="card col">
          <b>Visits by hour (last 30 days)</b>
          <BarChart data={hours} label={(y) => `${y} check-ins`} />
          <div className="row wrap small">
            <span className="tag">{stats?.visits30d ?? 0} visits</span>
            <span className="tag">{stats?.students30d ?? 0} students</span>
            <span className="tag">{stats?.redemptions ?? 0} rewards redeemed</span>
          </div>
          <div className="tiny muted">Source: {stats?.source}</div>
        </div>

        <div className="card col">
          <b>Your offer</b>
          <div className="field"><label>Reward</label><input className="input" value={o.title} onChange={(e) => setO({ ...o, title: e.target.value })} /></div>
          <div className="field"><label>Stamps needed</label><input className="input" type="number" min={2} max={20} value={o.stampsNeeded} onChange={(e) => setO({ ...o, stampsNeeded: Number(e.target.value) })} /></div>
          <label className="check"><input type="checkbox" checked={o.active} onChange={(e) => setO({ ...o, active: e.target.checked })} /><span>Offer active</span></label>
          <label className="check"><input type="checkbox" checked={o.slow} onChange={(e) => setO({ ...o, slow: e.target.checked })} /><span>Slow-hour bonus: extra points for students who come in when you're quiet</span></label>
          {o.slow && (
            <>
              <div className="chips">
                {DAYS.map((d, i) => <button key={d} className={`chip ${o.days.includes(i) ? "on" : ""}`} onClick={() => setO({ ...o, days: o.days.includes(i) ? o.days.filter((x) => x !== i) : [...o.days, i].sort() })}>{d}</button>)}
              </div>
              <div className="row">
                <div className="field grow"><label>From</label><select className="input" value={o.startHour} onChange={(e) => setO({ ...o, startHour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select></div>
                <div className="field grow"><label>To</label><select className="input" value={o.endHour} onChange={(e) => setO({ ...o, endHour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h + 1} value={h + 1}>{hourLabel((h + 1) % 24)}</option>)}</select></div>
                <div className="field grow"><label>Points</label><select className="input" value={o.multiplier} onChange={(e) => setO({ ...o, multiplier: Number(e.target.value) })}>{[1.5, 2, 3].map((m) => <option key={m} value={m}>x{m}</option>)}</select></div>
              </div>
            </>
          )}
          <button className="btn primary" onClick={saveOffer}>Save offer</button>
        </div>
        <div className="card col poster">
          <b>Counter poster</b>
          <div className="small muted">Print this for your counter. Students scan it to find you and collect your stop.</div>
          <div className="center" style={{ background: "#fff", color: "#0d0e12", borderRadius: 16, padding: 16 }}>
            <div style={{ fontWeight: 900, fontSize: 22 }}>📍 {me.partner.name}</div>
            <div style={{ fontWeight: 700 }}>is a Charlie on the MTA local partner</div>
            <img alt="QR code" src={`/api/qr.svg?text=${encodeURIComponent(`${location.origin}/?spot=${me.partner.spotId}`)}`} style={{ width: 200, height: 200, margin: "10px auto", display: "block" }} />
            <div style={{ fontSize: 14 }}>Scan · check in · collect the {me.partner.station} stop · earn a stamp</div>
          </div>
          <button className="btn" onClick={() => window.print()}>🖨️ Print poster</button>
        </div>
        {stats?.recent?.length > 0 && (
          <div className="card col">
            <b>Recent redemptions</b>
            {stats.recent.map((r: any, i: number) => (
              <div key={i} className="row between small"><span>{r.reward} · {new Date(r.at).toLocaleString()}</span>{r.solana ? <a href={r.solana} target="_blank" rel="noreferrer">on-chain receipt ↗</a> : <span className="muted">no receipt</span>}</div>
            ))}
            <div className="tiny muted">Each redemption is written to Solana devnet as a receipt you can verify without trusting our app.</div>
          </div>
        )}
        <p className="tiny muted">Free for owners. Students see a “Local partner” badge on your pin. Stamps are separate from leaderboard points, so redeeming never costs a student their rank.</p>
      </div>
    </div>
  );
}
