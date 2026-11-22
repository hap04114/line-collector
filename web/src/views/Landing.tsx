/**
 * Landing page in a "Boston Bound" hackathon spirit: sky blue, retro app windows, a live
 * departure board fed by the real MBTA poller, and sign-in built in. Original design;
 * no event or sponsor logos.
 */
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { LANGS, useI18n } from "../i18n";
import { useStore } from "../store";

function Win({ title, children, className = "", accent }: { title: string; children: ReactNode; className?: string; accent?: string }) {
  return (
    <section className={`lp-win ${className}`}>
      <div className="lp-bar" style={accent ? { background: accent } : undefined}>
        <span className="lp-bar-title">{title}</span>
        <span className="lp-bar-btns" aria-hidden><i>_</i><i>□</i><i>✕</i></span>
      </div>
      <div className="lp-win-body">{children}</div>
    </section>
  );
}

function DepartureBoard() {
  const [d, setD] = useState<any>(null);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const load = () => api.get("/lines/status").then(setD).catch(() => {});
    load();
    const a = setInterval(load, 30_000), b = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);
  const status = (l: any) => (l.shuttle ? "SHUTTLE BUSES" : l.chaos >= 60 ? "MAJOR DELAYS" : l.chaos >= 30 ? "MINOR DELAYS" : "ON TIME");
  return (
    <div className="lp-board" aria-label="Live T status">
      <div className="lp-board-head">
        <span>LIVE T · BOSTON BOUND</span>
        <span>{now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
      </div>
      {(d?.lines ?? []).map((l: any) => (
        <div key={l.routeId} className="lp-board-row">
          <span className="lp-dot" style={{ background: l.color }} />
          <span className="lp-line">{l.name.toUpperCase()}</span>
          <span className="lp-trains">{l.vehicles} TRAINS</span>
          <span className={`lp-status ${l.shuttle || l.chaos >= 60 ? "bad" : l.chaos >= 30 ? "warn" : ""}`}>{status(l)}</span>
        </div>
      ))}
      {!d && <div className="lp-board-row"><span className="lp-line">CONNECTING TO THE T…</span></div>}
      <div className="lp-board-foot">Live from the MBTA every 30 s · stored in Tiger Data</div>
    </div>
  );
}

export function Landing() {
  const s = useStore();
  const { t, lang, setLang } = useI18n();
  const cfg = s.config!;
  const [school, setSchool] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ devLink?: string; sent: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = cfg.schools.find((x) => x.id === school);

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
  const send = async () => {
    setErr(null);
    setBusy(true);
    try {
      setSent(await api.post("/auth/start", { email }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="lp">
      <nav className="lp-nav">
        <div className="lp-logo">LINE<b>COLLECTOR</b></div>
        <div className="lp-links">
          <button onClick={() => go("how")}>How it works</button>
          <button onClick={() => go("safe")}>Safety</button>
          <button onClick={() => go("local")}>Local</button>
          <button onClick={() => go("play")}>Play</button>
        </div>
        <select className="lp-lang" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("language")}>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <button className="lp-btn yellow" onClick={() => go("board")}>Sign in</button>
      </nav>

      <header className="lp-hero">
        <div className="lp-hero-copy">
          <div className="lp-chips">
            <span className="lp-chip">BostonHacks 2026</span>
            <span className="lp-chip">Track · Bos(tons) of Eats and Streets</span>
            <span className="lp-chip">+ Transit Gamification</span>
          </div>
          <h1>Boston bound,<br />one stop at a time.</h1>
          <p className="lp-lead">
            No car, about $10 a meal, and a city you don't know yet. Line Collector shows you cheap food and study spots you can reach by T
            right now, walks you through your first week, and turns getting out of the campus bubble into a game your whole school plays.
          </p>
          <div className="lp-cta">
            <button className="lp-btn yellow big" onClick={() => go("board")}>▶ Start my first week</button>
            {cfg.demoMode && cfg.personas.map((p) => (
              <button key={p.key} className="lp-btn ghost" disabled={busy} onClick={() => demo(p.key)}>
                Try as {p.name.replace(" (demo)", "")} · {cfg.schools.find((x) => x.id === p.school)?.short}
              </button>
            ))}
          </div>
        </div>
        <Win title="DEPARTURES.EXE" className="lp-hero-win">
          <DepartureBoard />
        </Win>
      </header>

      <div className="lp-stats">
        <div><b>159,720</b><span>students at Boston's colleges</span></div>
        <div><b>80,419</b><span>international students in Massachusetts</span></div>
        <div><b>52%</b><span>of students report high loneliness</span></div>
        <div><b>490+</b><span>Boston rental scam victims this year (FBI)</span></div>
      </div>

      <main className="lp-main">
        <div id="how" className="lp-grid three">
          <Win title="01_ARRIVE.EXE" accent="#125DC7">
            <div className="lp-emoji">🗓️</div>
            <h3>Your first week in Boston</h3>
            <p>Five quests to real places nearby: food that tastes like home, a free landmark, your study spot, a line you've never ridden, and how to rent without getting scammed.</p>
          </Win>
          <Win title="02_EXPLORE.EXE" accent="#125DC7">
            <div className="lp-emoji">🍜</div>
            <h3>Cheap food and study spots by T</h3>
            <p>Search by craving, budget, diet (halal, vegetarian, vegan) and open-late, or just say "cozy dumplings, cheap". Check in with a photo to collect the stop.</p>
          </Win>
          <Win title="03_BELONG.EXE" accent="#125DC7">
            <div className="lp-emoji">🏆</div>
            <h3>Your school vs. the other six</h3>
            <p>Collected stops fill in with your school's color. The weekly board ranks schools fairly, by average points per active player, and resets every Monday.</p>
          </Win>
        </div>

        <div id="safe" className="lp-grid two">
          <Win title="LISTING_CHECK.EXE" accent="#CE2634">
            <div className="lp-emoji">🛡️</div>
            <h3>Rent without getting scammed</h3>
            <p>Paste any listing or a screenshot. We flag broker fees you may not owe under the 2025 Massachusetts law, plus scam signs like "owner overseas" and "wire the deposit today", and show where to report it.</p>
          </Win>
          <Win title="SUBLETS.EXE" accent="#CE2634">
            <div className="lp-emoji">🔑</div>
            <h3>Verified student sublets</h3>
            <p>Only verified students post. Every listing is checked first: a real address, price vs. typical rent, scam text, reused photos. Contact details appear only after both sides accept.</p>
          </Win>
        </div>

        <div id="local" className="lp-grid two">
          <Win title="LOCAL_PARTNERS.EXE" accent="#0C6B14">
            <div className="lp-emoji">☕</div>
            <h3>Independent spots, slow-hour rewards</h3>
            <p>Punch cards at local spots, double points when they're quiet, 2-minute redemption codes, counter QR posters, and receipts the business can verify on-chain.</p>
          </Win>
          <Win title="BOSTONIAN.EXE" accent="#0C6B14">
            <div className="lp-emoji">🦞</div>
            <h3>How a new student becomes a Bostonian</h3>
            <p>Collect stamps from Boston's 23 neighborhoods, leave tips for the next student, and catch events on the city's calendar, from the Head of the Charles to Marathon Monday.</p>
          </Win>
        </div>

        <div id="play">
          <Win title="STREET_RUNNER.EXE" accent="#030087" className="lp-play">
            <div className="lp-play-row">
              <div>
                <div className="lp-emoji">🏃</div>
                <h3>Run your T line through the real streets</h3>
                <p>Street Runner follows your line's real route through real Boston: real buildings, real street names, a sign at every real station. Dodge shuttle buses, grab tokens, beat your school's best.</p>
              </div>
              <div className="lp-lines">
                {["#DA291C", "#ED8B00", "#003DA5", "#00843D"].map((c) => <span key={c} style={{ background: c }} />)}
              </div>
            </div>
          </Win>
        </div>

        <div id="board" className="lp-grid two">
          <Win title="SIGN_IN.EXE" accent="#206DDF" className="lp-signin">
            <h3>Pick your school</h3>
            <div className="lp-schools">
              {cfg.schools.map((x) => (
                <button key={x.id} className={`lp-school ${school === x.id ? "on" : ""}`} style={{ borderLeftColor: x.color }} onClick={() => { setSchool(x.id); setEmail(email || `@${x.emailDomains[0]}`); }}>
                  <b>{x.short}</b><span>{x.city}</span>
                </button>
              ))}
            </div>
            {school && !sent && (
              <div className="lp-form">
                <label htmlFor="lp-em">Your school email ({chosen?.emailDomains[0]})</label>
                <input id="lp-em" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`you@${chosen?.emailDomains[0]}`} />
                <button className="lp-btn yellow" disabled={busy || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)} onClick={send}>✉️ Send my sign-in link</button>
                <small>The link goes to your real school inbox, so nobody can pretend to be a student.</small>
              </div>
            )}
            {sent && (
              <div className="lp-sent">
                <b>Check your school inbox for the sign-in link.</b>
                {sent.devLink && <a className="lp-btn yellow" href={sent.devLink}>Open sign-in link (dev)</a>}
              </div>
            )}
            {err && <div className="lp-err">{err}</div>}
            <div className="lp-row">
              <button className="lp-link" onClick={() => s.setSignedOutBrowse(true)}>👀 Just look around</button>
              <a className="lp-link" href="/owner">🏪 I own a local spot</a>
            </div>
          </Win>
          <Win title="BUILT_WITH.TXT" accent="#4A5565">
            <ul className="lp-built">
              <li><b>Gemini</b> checks check-in photos, reads menus into prices, scans listings for scams, and powers search by meaning.</li>
              <li><b>Mastra</b> runs the Stop Planner as a checked, six-step workflow.</li>
              <li><b>Tiger Data</b> stores live trains and check-ins as time series, with live aggregates and vector search in one database.</li>
              <li><b>Vultr</b> runs the app and the 24/7 train poller, with HTTPS so phone GPS works.</li>
              <li><b>MBTA V3 API</b>, <b>OpenStreetMap</b>, <b>Analyze Boston</b>, <b>Open-Meteo</b> for real data.</li>
            </ul>
          </Win>
        </div>
      </main>

      <footer className="lp-foot">
        Built at BostonHacks 2026 · Map data © OpenStreetMap contributors · Transit data from the MBTA · Not affiliated with the MBTA or any school
      </footer>
    </div>
  );
}
