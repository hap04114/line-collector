import { useEffect, useState } from "react";
import { api } from "../api";
import { useI18n } from "../i18n";
import { nearestStation, useStore } from "../store";
import { Sheet } from "../components/Sheet";
import { HousingFinder } from "../components/HousingFinder";

const SAMPLE_LISTING = `EXAMPLE LISTING (made up for the demo)
Sunny 1BR near Northeastern, only $950/mo! Broker fee: one month's rent.
I'm currently overseas for work so I can't show the apartment, but keys will be mailed to you.
Please wire the deposit today to hold it, many applicants are interested. Text me on WhatsApp.`;

export function LiveView() {
  const s = useStore();
  const { t } = useI18n();
  const [tab, setTab] = useState<"find" | "check" | "list" | "post" | "mine">("find");
  return (
    <Sheet title={`🏠 ${t("live")}`} sub="Scout where to live next year" onClose={() => { s.setPanel(null); s.setMode("explore"); }} full>
      <div className="seg">
        <button className={tab === "find" ? "on" : ""} onClick={() => setTab("find")}>🔑 Find a place</button>
        <button className={tab === "check" ? "on" : ""} onClick={() => setTab("check")}>{t("listingCheck")}</button>
        <button className={tab === "list" ? "on" : ""} onClick={() => setTab("list")} disabled={!s.me}>{t("sublets")}</button>
        <button className={tab === "post" ? "on" : ""} onClick={() => setTab("post")} disabled={!s.me}>{t("postSublet")}</button>
        <button className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")} disabled={!s.me}>{t("mine")}</button>
      </div>
      <div className="banner warn small">🛡️ {t("neverPay")}</div>
      {tab === "find" && <HousingFinder onCheckListing={() => setTab("check")} onSublets={() => setTab("list")} />}
      {tab === "check" && <ListingCheck />}
      {tab === "list" && <SubletList />}
      {tab === "post" && <PostSublet onDone={() => setTab("mine")} />}
      {tab === "mine" && <MySublets />}
    </Sheet>
  );
}

function ListingCheck() {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [shot, setShot] = useState<File | null>(null);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("text", text);
      if (shot) fd.append("screenshot", shot);
      setRes(await api.form("/listing-check", fd));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="small muted">{t("listingHint")}</div>
      <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the listing text here…" />
      <div className="row wrap">
        <label className="btn sm ghost">📷 Screenshot<input type="file" accept="image/*" className="hidden" onChange={(e) => setShot(e.target.files?.[0] ?? null)} /></label>
        {shot && <span className="small">{shot.name}</span>}
        <button className="btn sm ghost" onClick={() => setText(SAMPLE_LISTING)}>Try an example</button>
      </div>
      <button className="btn primary block" disabled={busy || (!text.trim() && !shot)} onClick={run}>{busy ? "Checking…" : `🔎 ${t("checkIt")}`}</button>
      {err && <div className="banner danger">{err}</div>}
      {res && (
        <div className="col">
          <div className={`banner ${res.flags.some((f: any) => f.severity === "high") ? "danger" : res.flags.length ? "warn" : "ok"}`}><b>{res.summary}</b></div>
          {res.flags.map((f: any, i: number) => (
            <div key={i} className={`flag ${f.severity}`}>
              <div className="row between"><b>{labelFor(f.type)}</b><span className={`tag ${f.severity === "high" ? "danger" : f.severity === "medium" ? "warn" : ""}`}>{f.severity}</span></div>
              {f.quote && <div className="small mono muted">“{f.quote}”</div>}
              <div className="small" style={{ marginTop: 4 }}>{f.explanation}</div>
            </div>
          ))}
          {res.typicalRent && <div className="small muted">Typical rent: ${Math.round(res.typicalRent.median).toLocaleString()} · {res.typicalRent.source}</div>}
          {res.guidance && <a className="btn sm ghost" href={res.guidance} target="_blank" rel="noreferrer">Massachusetts broker-fee guidance ↗</a>}
          {res.flags.some((f: any) => f.severity === "high") && (
            <div className="banner small">
              <b>Already paid or shared personal info?</b> Report it:{" "}
              <a href="https://www.ic3.gov/" target="_blank" rel="noreferrer">FBI Internet Crime Complaint Center ↗</a> ·{" "}
              <a href="https://www.mass.gov/how-to/file-a-consumer-complaint" target="_blank" rel="noreferrer">Massachusetts Attorney General ↗</a>. Contact your bank right away if you sent money.
            </div>
          )}
          <div className="tiny muted">{res.disclaimer} Checked by {res.checkedBy}. Charlie on the MTA never passes messages between students and brokers.</div>
        </div>
      )}
    </>
  );
}
const labelFor = (t: string) =>
  ({ broker_fee: "💸 Broker fee you may not owe", payment_method: "🏧 Risky payment method", owner_abroad: "✈️ Owner is “abroad”", no_viewing: "🚪 No viewing before paying", pressure: "⏰ Pressure to pay fast", upfront_costs: "🧾 Upfront fees", price: "🤔 Too good to be true", identity: "📵 Moves you off-platform", address: "📍 Address", other: "⚠️ Other" })[t] ?? t;

function SubletList() {
  const s = useStore();
  const [list, setList] = useState<any[] | null>(null);
  const [contactFor, setContactFor] = useState<string | null>(null);
  const [contact, setContact] = useState(s.me?.user?.contact ?? "");
  const [msg, setMsg] = useState("");
  const load = () => api.get("/sublets").then((r) => setList(r.sublets));
  useEffect(() => {
    load();
  }, []);
  const request = async (id: string) => {
    try {
      await api.post(`/sublets/${id}/request`, { message: msg, contact });
      s.toast("Request sent. Contact details appear once the poster accepts.");
      setContactFor(null);
      load();
    } catch (e) {
      s.toast((e as Error).message);
    }
  };
  if (!list) return <div className="muted">Loading…</div>;
  if (!list.length) return <div className="banner">No verified sublets yet. Students at your school see yours first.</div>;
  return (
    <div className="list">
      {list.map((x) => (
        <div key={x.id} className="card col">
          {x.photos?.[0] && <img src={x.photos[0]} alt="" className="photo-preview" style={{ maxHeight: 180 }} />}
          <div className="row between"><b>{x.title}</b><b>${x.price}/mo</b></div>
          <div className="small muted">
            {x.school} student · near {x.area} ({x.walkMin} min walk) · ~{x.commuteMin} min to campus · {x.startDate} → {x.endDate}
            {x.bedrooms != null && ` · ${x.bedrooms === 0 ? "studio" : `${x.bedrooms}BR`}`}
          </div>
          <div className="row wrap">{x.badges.map((b: string) => <span key={b} className="tag ok">✓ {b}</span>)}</div>
          {x.description && <div className="small">{x.description}</div>}
          {x.contact ? <div className="banner ok small">Contact: <b>{x.contact}</b>{x.address && <> · {x.address}</>}</div>
            : x.myRequest ? <div className="tag">Request {x.myRequest}</div>
            : contactFor === x.id ? (
              <div className="col">
                <input className="input" placeholder="Your contact (shared only if they accept)" value={contact} onChange={(e) => setContact(e.target.value)} />
                <input className="input" placeholder="Short message (optional)" value={msg} maxLength={400} onChange={(e) => setMsg(e.target.value)} />
                <button className="btn primary" disabled={contact.trim().length < 3} onClick={() => request(x.id)}>Send request</button>
              </div>
            ) : (
              <div className="row">
                {!x.mine && <button className="btn" onClick={() => setContactFor(x.id)}>Request contact</button>}
                <div className="grow" />
                {!x.mine && <button className="btn sm ghost" onClick={() => api.post(`/sublets/${x.id}/report`).then(() => { s.toast("Reported. Listing hidden until reviewed."); load(); })}>⚑ Report</button>}
              </div>
            )}
        </div>
      ))}
    </div>
  );
}

function PostSublet({ onDone }: { onDone: () => void }) {
  const s = useStore();
  const [f, setF] = useState({ title: "", address: "", zip: "", startDate: "", endDate: "", price: "", bedrooms: "1", description: "", contact: s.me?.user?.contact ?? "", consent: false });
  const [photos, setPhotos] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(f)) if (k !== "consent") fd.append(k, String(v));
      fd.append("landlordConsent", String(f.consent));
      const near = nearestStation(s.statics?.stations ?? [], s.pos);
      if (near && s.pos) { fd.append("lat", String(s.pos.lat)); fd.append("lon", String(s.pos.lon)); }
      for (const p of Array.from(photos ?? [])) fd.append("photos", p);
      setRes(await api.form("/sublets", fd));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (res)
    return (
      <div className="col">
        <div className={`banner ${res.status === "live" ? "ok" : "warn"}`}>{res.status === "live" ? `✓ Live near ${res.station}.` : "Held for review. Here's what our checks flagged:"}</div>
        <div className="row wrap">{res.badges.map((b: string) => <span key={b} className="tag ok">✓ {b}</span>)}</div>
        {res.flags.map((x: any, i: number) => <div key={i} className={`flag ${x.severity}`}><b>{labelFor(x.type)}</b><div className="small">{x.explanation}</div></div>)}
        <button className="btn" onClick={onDone}>See my listings</button>
      </div>
    );
  return (
    <div className="col">
      <div className="tiny muted">Every listing is checked before it goes live: the address must exist, the price is compared with typical rent, the text is scanned for scam signs, and photos are compared with every earlier listing. Sublets earn no game points.</div>
      <div className="field"><label>Title</label><input className="input" value={f.title} onChange={set("title")} placeholder="Summer sublet, 1BR in Mission Hill" /></div>
      <div className="field"><label>Street address (exact address shown only after you accept)</label><input className="input" value={f.address} onChange={set("address")} /></div>
      <div className="row"><div className="field grow"><label>ZIP</label><input className="input" value={f.zip} inputMode="numeric" maxLength={5} onChange={set("zip")} /></div><div className="field grow"><label>Bedrooms</label><select className="input" value={f.bedrooms} onChange={set("bedrooms")}>{["0", "1", "2", "3", "4"].map((b) => <option key={b} value={b}>{b === "0" ? "Studio" : b}</option>)}</select></div></div>
      <div className="row"><div className="field grow"><label>From</label><input className="input" type="date" value={f.startDate} onChange={set("startDate")} /></div><div className="field grow"><label>To</label><input className="input" type="date" value={f.endDate} onChange={set("endDate")} /></div></div>
      <div className="field"><label>Monthly rent ($)</label><input className="input" inputMode="numeric" value={f.price} onChange={set("price")} /></div>
      <div className="field"><label>Description</label><textarea className="input" value={f.description} onChange={set("description")} /></div>
      <div className="field"><label>Photos (up to 5)</label><input className="input" type="file" accept="image/*" multiple onChange={(e) => setPhotos(e.target.files)} /></div>
      <div className="field"><label>Your contact (shared only after both accept)</label><input className="input" value={f.contact} onChange={set("contact")} /></div>
      <label className="check"><input type="checkbox" checked={f.consent} onChange={set("consent")} /><span>My landlord allows subletting (many Boston leases require written consent).</span></label>
      {err && <div className="banner danger">{err}</div>}
      <button className="btn primary" disabled={busy || !f.consent || !f.title || !f.address || !f.price || !f.startDate || !f.endDate || f.contact.length < 3} onClick={submit}>{busy ? "Running checks…" : "Run checks & post"}</button>
    </div>
  );
}

function MySublets() {
  const s = useStore();
  const [d, setD] = useState<any>(null);
  const load = () => api.get("/sublets/mine").then(setD);
  useEffect(() => {
    load();
  }, []);
  if (!d) return <div className="muted">Loading…</div>;
  return (
    <div className="col">
      <h3>My listings</h3>
      {d.posts.length === 0 && <div className="small muted">None yet.</div>}
      {d.posts.map((p: any) => (
        <div key={p.id} className="card tight"><b>{p.title}</b> · ${p.price}/mo · <span className={`tag ${p.status === "live" ? "ok" : "warn"}`}>{p.status}</span></div>
      ))}
      <h3>Requests to me</h3>
      {d.incoming.length === 0 && <div className="small muted">No requests yet.</div>}
      {d.incoming.map((r: any) => (
        <div key={r.id} className="card col">
          <div><b>{r.from}</b> ({r.school}) · {r.status}</div>
          {r.message && <div className="small">“{r.message}”</div>}
          {r.contact && <div className="banner ok small">Contact: <b>{r.contact}</b></div>}
          {r.status === "pending" && (
            <div className="row">
              <button className="btn primary sm" onClick={() => api.post(`/sublet-requests/${r.id}/accept`).then(load)}>Accept</button>
              <button className="btn sm" onClick={() => api.post(`/sublet-requests/${r.id}/decline`).then(load)}>Decline</button>
            </div>
          )}
        </div>
      ))}
      <h3>My requests</h3>
      {d.outgoing.map((r: any) => (
        <div key={r.id} className="card tight">{r.title} · {r.status}{r.contact && <> · contact: <b>{r.contact}</b></>}</div>
      ))}
      {s.me && null}
    </div>
  );
}
