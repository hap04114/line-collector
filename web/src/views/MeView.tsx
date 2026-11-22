import { useEffect, useState } from "react";
import { api, money, timeAgo } from "../api";
import { LANGS, useI18n } from "../i18n";
import { LinePill, useStore } from "../store";
import { Sheet, Stepper } from "../components/Sheet";

const REGIONS = [
  ["south-asian", "South Asian"], ["east-asian", "East Asian"], ["southeast-asian", "Southeast Asian"], ["middle-eastern", "Middle Eastern"],
  ["latin-american", "Latin American"], ["caribbean", "Caribbean"], ["african", "African"], ["european", "European"], ["mediterranean", "Mediterranean"],
] as const;

export function MeView() {
  const s = useStore();
  const { t, lang, setLang, translating } = useI18n();
  const me = s.me;
  const [cards, setCards] = useState<any[]>([]);
  const [code, setCode] = useState<{ offerId: string; code: string; expiresAt: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [form, setForm] = useState(() => ({ name: me?.user.name ?? "", budget: Math.round((me?.user.budgetCents ?? 1000) / 100), baseline: Math.round((me?.user.baselineCents ?? 1500) / 100), regions: me?.user.homeRegions ?? [], contact: me?.user.contact ?? "" }));

  useEffect(() => {
    api.get("/rewards").then((r) => setCards(r.cards)).catch(() => {});
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  if (!me) return null;

  const redeem = async (offerId: string) => {
    try {
      const r = await api.post("/redeem", { offerId });
      setCode({ offerId, ...r });
    } catch (e) {
      s.toast((e as Error).message);
    }
  };
  const save = async () => {
    await api.post("/me", { name: form.name, budgetCents: form.budget * 100, baselineCents: form.baseline * 100, homeRegions: form.regions, contact: form.contact, lang });
    await s.refresh();
    s.toast("Saved");
  };
  const signOut = async () => {
    await api.post("/auth/logout");
    location.reload();
  };
  const yb = me.yourBoston;
  const left = code ? Math.max(0, Math.round((new Date(code.expiresAt).getTime() - now) / 1000)) : 0;

  return (
    <Sheet title={me.user.name} sub={<span className="row"><span className="school-dot" style={{ background: me.user.school.color }} />{me.user.school.name} · {me.level.name} · {me.points.toLocaleString()} pts</span>} onClose={() => s.setPanel(null)} full>
      {me.user.isDemo && <div className="banner info small">You're using a demo account with seeded history.</div>}
      <div className="card hero col">
        <h3>🗺️ {t("yourBoston")}</h3>
        <div className="row between">
          <div><div className="big-num">{money(yb.moneySavedCents)}</div><div className="small muted">{t("moneySaved")} ({money(yb.baselineCents)}/meal, est. prices)</div></div>
        </div>
        <div className="row between">
          <div><div className="big-num">{yb.neighborhoods.explored}<span className="muted" style={{ fontSize: 18 }}>/{yb.neighborhoods.total}</span></div><div className="small muted">Boston {t("neighborhoods")}{yb.neighborhoods.bonus ? ` + ${yb.neighborhoods.bonus} bonus` : ""}</div></div>
          <div style={{ textAlign: "right" }}><div className="big-num">{yb.localSpots}</div><div className="small muted">{t("localSpots")}</div></div>
        </div>
      </div>

      <div className="card col">
        <div className="row between"><b>{t("level")}: {me.level.name}</b><span className="small muted">{me.level.next ? `${(me.level.next.min - me.points).toLocaleString()} to ${me.level.next.name}` : "Max level"}</span></div>
        <div className="bar"><i style={{ width: `${me.level.progress * 100}%`, background: me.user.school.color }} /></div>
        <div className="small">🔥 {me.streak.weeks} {t("streak")} · {me.streak.state === "safe" ? t("streakSafe") : me.streak.state === "skip" ? t("streakSkip") : me.streak.state === "due" ? t("streakDue") : "Collect a new stop to start one"} · {me.streak.skipsLeft} skip left this month</div>
      </div>

      <h3>🏷️ {t("stamps")}</h3>
      <div className="stamps">
        {(s.statics?.neighborhoods ?? []).map((n) => {
          const got = me.stamps.includes(n.id);
          return (
            <div key={n.id} className={`stamp ${got ? "got" : ""}`} style={got ? { borderColor: n.color, background: `${n.color}22` } : undefined} title={n.blurb}>
              <span className="i">{n.icon}</span>
              {n.name}
            </div>
          );
        })}
      </div>

      <h3>🚇 {t("lines")} · {me.stops.collected}/{me.stops.total} stops</h3>
      <div className="list">
        {me.lines.map((l: any) => (
          <div key={l.id} className="row">
            <LinePill id={l.id} />
            <div className="grow bar"><i style={{ width: `${(100 * l.have) / l.total}%`, background: l.color }} /></div>
            <span className="small" style={{ minWidth: 44, textAlign: "right" }}>{l.have}/{l.total}</span>
          </div>
        ))}
      </div>

      <h3>🏅 {t("badges")}</h3>
      <div className="badges">
        {me.badges.map((b: any) => (
          <div key={b.id} className={`badge ${b.earnedAt ? "" : "off"}`} title={b.description}>
            <span className="i">{b.icon}</span>
            {b.name}
            {b.solanaSig && <div><a className="tiny" href={`https://explorer.solana.com/tx/${b.solanaSig}?cluster=devnet`} target="_blank" rel="noreferrer">on Solana ↗</a></div>}
          </div>
        ))}
      </div>

      <h3>⭐ {t("punchCards")}</h3>
      {cards.length === 0 && <div className="small muted">No partner offers yet.</div>}
      <div className="list">
        {cards.map((c) => (
          <div key={c.offerId} className="card col">
            <div className="row between"><b>{c.name}</b>{c.isSample && <span className="tag warn">{t("sampleOffer")}</span>}</div>
            <div className="small muted">{c.offer} · {c.station}</div>
            <div style={{ fontSize: 22, letterSpacing: 4 }}>{Array.from({ length: c.needed }, (_, i) => (i < c.stamps ? "🟡" : "⚪")).join("")}</div>
            {code?.offerId === c.offerId && left > 0 ? (
              <div className="banner ok center">
                <div className="small">{t("showStaff")} {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</div>
                <div className="code-display mono">{code!.code}</div>
              </div>
            ) : (
              <button className="btn" disabled={c.stamps < c.needed} onClick={() => redeem(c.offerId)}>{c.stamps >= c.needed ? `🎁 ${t("redeem")}` : `${c.needed - c.stamps} more check-ins`}</button>
            )}
          </div>
        ))}
      </div>

      <h3>🕘 Recent check-ins</h3>
      <div className="list">
        {me.recent.map((r: any) => (
          <div key={r.id} className="row between small">
            <span>{r.spot_name} · {s.stationById.get(r.station_id)?.name}</span>
            <span className="muted">{r.verified === "pending" ? "checking…" : r.verified === "rejected" ? "rejected" : `+${r.points}`} · {timeAgo(r.ts)}</span>
          </div>
        ))}
      </div>

      <h3>⚙️ {t("settings")}</h3>
      <div className="card col">
        <div className="field">
          <label>{t("language")} {translating && "(translating…)"}</label>
          <div className="chips">{LANGS.map((l) => <button key={l.code} className={`chip ${lang === l.code ? "on" : ""}`} onClick={() => setLang(l.code)}>{l.label}</button>)}</div>
        </div>
        <div className="field">
          <label>{t("homeFood")} (Taste of Home)</label>
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {REGIONS.map(([id, label]) => (
              <button key={id} className={`chip ${form.regions.includes(id) ? "on" : ""}`} onClick={() => setForm({ ...form, regions: form.regions.includes(id) ? form.regions.filter((x: string) => x !== id) : [...form.regions, id] })}>{label}</button>
            ))}
          </div>
        </div>
        <div className="row between"><span className="small">{t("myBudget")}</span><Stepper value={form.budget} min={3} max={50} step={1} format={(v) => `$${v}`} onChange={(v) => setForm({ ...form, budget: v })} /></div>
        <div className="row between"><span className="small">{t("myBaseline")}</span><Stepper value={form.baseline} min={5} max={50} step={1} format={(v) => `$${v}`} onChange={(v) => setForm({ ...form, baseline: v })} /></div>
        <div className="field"><label>Name</label><input className="input" value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="field"><label>{t("contact")}</label><input className="input" value={form.contact} maxLength={120} placeholder="e.g. Instagram handle or phone" onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
        <button className="btn primary" onClick={save}>{t("save")}</button>
      </div>
      <div className="small muted">{t("friendCode")}: <b className="mono">{me.user.friendCode}</b></div>
      <button className="btn danger" onClick={signOut}>{t("signOut")}</button>
    </Sheet>
  );
}
