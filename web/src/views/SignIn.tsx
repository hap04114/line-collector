import { useState } from "react";
import { api } from "../api";
import { LANGS, useI18n } from "../i18n";
import { useStore } from "../store";

export function SignIn() {
  const s = useStore();
  const { t, lang, setLang } = useI18n();
  const [school, setSchool] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [sent, setSent] = useState<{ devLink?: string; sent: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cfg = s.config!;
  const chosen = cfg.schools.find((x) => x.id === school);

  const send = async () => {
    setErr(null);
    setBusy(true);
    try {
      setSent(await api.post("/auth/start", { email, name: name || undefined }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const demo = async (persona: string) => {
    setBusy(true);
    try {
      await api.post("/auth/demo", { persona });
      await s.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <div className="signin-wrap">
        <div className="row between">
          <div className="logo">Line <i>Collector</i></div>
          <select className="input" style={{ width: "auto", minHeight: 40 }} value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("language")}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <p style={{ fontSize: 18, margin: 0 }}>{t("tagline")}</p>
        <div className="row wrap small muted">
          <span className="tag">🚇 Live MBTA</span><span className="tag">🍜 Under $10</span><span className="tag">📚 Study spots</span><span className="tag">🏆 7 schools</span>
        </div>

        {cfg.demoMode && cfg.personas.length > 0 && (
          <div className="card hero col">
            <b>{t("tryDemo")}</b>
            <div className="row wrap">
              {cfg.personas.map((p) => (
                <button key={p.key} className="btn primary" disabled={busy} onClick={() => demo(p.key)}>
                  {p.name.replace(" (demo)", "")} · {cfg.schools.find((x) => x.id === p.school)?.short}
                </button>
              ))}
            </div>
            <div className="tiny muted">Demo accounts with seeded history, for judging.</div>
          </div>
        )}

        <h3>{t("pickSchool")}</h3>
        <div className="school-grid">
          {cfg.schools.map((x) => (
            <button key={x.id} className={`school-card ${school === x.id ? "on" : ""}`} onClick={() => { setSchool(x.id); setEmail(email || `@${x.emailDomains[0]}`); }} style={{ borderLeft: `6px solid ${x.color}` }}>
              <b>{x.short}</b>
              <span className="tiny muted">{x.city}</span>
            </button>
          ))}
        </div>

        {school && !sent && (
          <div className="card col">
            <div className="field">
              <label htmlFor="em">{t("schoolEmail")} ({chosen?.emailDomains[0]})</label>
              <input id="em" className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`you@${chosen?.emailDomains[0]}`} />
            </div>
            <div className="field">
              <label htmlFor="nm">Name (optional)</label>
              <input id="nm" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </div>
            {err && <div className="error">{err}</div>}
            <button className="btn primary" disabled={busy || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)} onClick={send}>✉️ {t("sendLink")}</button>
            <div className="tiny muted">A link goes to your real school inbox, so a spoofed address can't sign in. Only students at these seven schools can join.</div>
          </div>
        )}
        {sent && (
          <div className="banner ok col">
            <b>{t("checkInbox")}</b>
            {sent.devLink && (
              <>
                <span className="small">{t("devLink")}</span>
                <a className="btn sm" href={sent.devLink}>Open sign-in link</a>
              </>
            )}
          </div>
        )}
        {err && !school && <div className="error">{err}</div>}
        <div className="row wrap">
          <button className="btn ghost" onClick={() => s.setSignedOutBrowse(true)}>👀 {t("justLook")}</button>
          <a className="btn ghost" href="/owner">🏪 {t("ownerPage")}</a>
        </div>
        <p className="tiny muted">
          Data: MBTA V3 API, © OpenStreetMap contributors, OpenFreeMap, Analyze Boston, Open-Meteo. Database: {cfg.database}. AI: {cfg.gemini ? `Gemini (${cfg.geminiModel})` : "Gemini not configured (rule-based fallbacks)"}.
        </p>
      </div>
    </div>
  );
}
