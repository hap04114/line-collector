/**
 * Landing page: clean, white, startup-style, with an animated product preview,
 * scroll reveals, count-up stats, a live MBTA board, and sign-in built in.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { LANGS, useI18n } from "../i18n";
import { useStore } from "../store";
import { Doodle } from "../components/Doodles";

/** Adds .in to every .rv element when it scrolls into view. */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const els = root.current?.querySelectorAll(".rv") ?? [];
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in")), { threshold: 0.12, root: root.current });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [root]);
}

function CountUp({ to, suffix = "", root }: { to: number; suffix?: string; root: React.RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / 1400);
        setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, { root: root.current, threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [to, root]);
  return <span ref={ref}>{v.toLocaleString()}{suffix}</span>;
}

/** Animated phone preview: lines draw in, a train runs, a stop gets collected. */
function PhonePreview() {
  return (
    <div className="ph" aria-hidden>
      <div className="ph-notch" />
      <div className="ph-screen">
        <div className="ph-top">
          <span className="ph-ring" />
          <div><b>1,240</b><small>this week</small></div>
          <div><b>🔥 3</b><small>streak</small></div>
          <span className="ph-school">BU</span>
        </div>
        <svg viewBox="0 0 300 380" className="ph-map">
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#eef1f6" strokeWidth="1" /></pattern>
          </defs>
          <rect width="300" height="380" fill="#f8fafc" />
          <rect width="300" height="380" fill="url(#grid)" />
          <path d="M-10 250 C 60 240, 90 200, 150 190" className="ph-river" />
          <path id="pg" d="M-10 300 C 60 290, 100 240, 150 200 S 240 150, 310 140" className="ph-line g" />
          <path id="pr" d="M40 -10 C 80 80, 120 140, 150 200 S 200 320, 230 390" className="ph-line r" />
          <path id="po" d="M260 -10 C 230 90, 190 150, 150 200 S 90 330, 70 390" className="ph-line o" />
          <path id="pb" d="M150 200 C 190 190, 240 210, 310 230" className="ph-line b" />
          <circle cx="150" cy="200" r="9" className="ph-hub" />
          <circle cx="96" cy="250" r="7" className="ph-st got" />
          <circle cx="214" cy="160" r="7" className="ph-st" />
          <circle cx="118" cy="132" r="7" className="ph-st got" />
          <circle cx="190" cy="300" r="7" className="ph-st pulse" />
          <circle r="6" className="ph-train g"><animateMotion dur="7s" repeatCount="indefinite" rotate="auto"><mpath href="#pg" /></animateMotion></circle>
          <circle r="6" className="ph-train r"><animateMotion dur="9s" repeatCount="indefinite" begin="1s"><mpath href="#pr" /></animateMotion></circle>
          <circle r="6" className="ph-train o"><animateMotion dur="8s" repeatCount="indefinite" begin="2s"><mpath href="#po" /></animateMotion></circle>
          <g className="ph-pin"><rect x="160" y="262" width="74" height="26" rx="13" /><text x="197" y="280">🎯 +300</text></g>
        </svg>
        <div className="ph-toast t1"><b>+150</b> new neighborhood · Fenway</div>
        <div className="ph-toast t2"><b>+100</b> new stop · Kenmore ✨</div>
        <div className="ph-card">
          <span className="ph-emoji">🍜</span>
          <div><b>Dumpling Palace</b><small>4 min walk · about $8 · open now</small></div>
          <span className="ph-go">Go</span>
        </div>
      </div>
    </div>
  );
}

function LiveBoard() {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    const load = () => api.get("/lines/status").then(setD).catch(() => {});
    load();
    const a = setInterval(load, 30_000);
    return () => clearInterval(a);
  }, []);
  const label = (l: any) => (l.shuttle ? "Shuttle buses" : l.chaos >= 60 ? "Major delays" : l.chaos >= 30 ? "Minor delays" : "Running well");
  return (
    <div className="lb">
      <div className="lb-head"><span className="lb-live"><i />Live</span> MBTA right now</div>
      {(d?.lines ?? []).map((l: any) => (
        <div key={l.routeId} className="lb-row">
          <span className="lb-pill" style={{ background: l.color }}>{l.name.replace("Green ", "G").replace(" Line", "")}</span>
          <span className="lb-name">{l.name}</span>
          <span className="lb-trains">{l.vehicles} trains</span>
          <span className={`lb-status ${l.shuttle || l.chaos >= 60 ? "bad" : l.chaos >= 30 ? "warn" : "ok"}`}>{label(l)}</span>
        </div>
      ))}
      {!d && <div className="lb-row"><span className="lb-name">Connecting to the T…</span></div>}
    </div>
  );
}

/** What's actually happening in Boston: live T alerts, weather, the city's calendar. */
function BostonNow() {
  const [st, setSt] = useState<any>(null);
  const [ev, setEv] = useState<any>(null);
  useEffect(() => {
    api.get("/lines/status").then(setSt).catch(() => {});
    api.get("/events").then(setEv).catch(() => {});
  }, []);
  const w = st?.weather;
  const disrupted = (st?.lines ?? []).filter((l: any) => l.shuttle || l.chaos >= 30);
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const upcoming = (ev?.upcoming ?? []).slice(0, 3);
  const active = (ev?.active ?? []).filter((e: any) => e.kind !== "partner" && e.kind !== "flag").slice(0, 2);
  const ticker: string[] = [
    ...(w ? [`🌡️ ${Math.round(w.tempF)}°F in Boston, feels like ${Math.round(w.feelsLikeF)}°F${w.warmUp ? " · Warm-Up quests are on (+30 indoors)" : ""}`] : []),
    ...disrupted.map((l: any) => `${l.shuttle ? "🚌" : "⏱️"} ${l.name}: ${l.alerts[0]?.header ?? (l.shuttle ? "shuttle buses" : "delays")}${l.shuttle ? " · stops here are worth x1.5" : ""}`),
    ...(st ? [`🚇 ${st.lines.reduce((a: number, l: any) => a + l.vehicles, 0)} trains running right now across ${st.lines.length} lines`] : []),
    ...active.map((e: any) => `🎉 Happening now: ${e.name}`),
    ...upcoming.map((e: any) => `📅 ${fmt(e.starts_at)}: ${e.name}${e.description ? ` · ${e.description}` : ""}`),
  ];
  return (
    <section id="now" className="lx-sec">
      <div className="lx-eyebrow rv">Boston right now</div>
      <h2 className="rv">What's actually happening in the city <span className="lx-hl">today</span></h2>
      <div className="lx-ticker rv" aria-label="Live Boston headlines">
        <div className="lx-ticker-track">
          {[...ticker, ...ticker].map((t, i) => <span key={i}>{t}</span>)}
          {!ticker.length && <span>Loading live Boston data…</span>}
        </div>
      </div>
      <div className="lx-now">
        <div className="lx-now-card rv">
          <Doodle name="snow" size={54} className="wiggle" />
          <b>{w ? `${Math.round(w.tempF)}°F` : "…"}</b>
          <span>{w ? (w.snowing ? "Snowing. First-snow bonus is on!" : w.warmUp ? "Bundle up: Warm-Up quests send you somewhere warm." : "Good day to ride somewhere new.") : "Checking the sky"}</span>
        </div>
        <div className="lx-now-card rv" style={{ transitionDelay: "100ms" }}>
          <Doodle name="trolley" size={54} className="wiggle" />
          <b>{disrupted.length ? `${disrupted.length} line${disrupted.length > 1 ? "s" : ""} acting up` : st ? "All lines running" : "…"}</b>
          <span>{disrupted.length ? `${disrupted.map((l: any) => l.name).join(", ")}. Shutdowns turn into bonus points.` : "Live from the MBTA every 30 seconds."}</span>
        </div>
        <div className="lx-now-card rv" style={{ transitionDelay: "200ms" }}>
          <Doodle name="rower" size={54} className="wiggle" />
          <b>{upcoming[0] ? fmt(upcoming[0].starts_at) : "Boston's calendar"}</b>
          <span>{upcoming[0] ? `${upcoming[0].name}. ${upcoming[0].description ?? ""}` : "Head of the Charles, Marathon Monday, move-in day and finals week become events."}</span>
        </div>
      </div>
    </section>
  );
}

function Feature({ icon, tint, title, children, delay = 0 }: { icon: string; tint: string; title: string; children: ReactNode; delay?: number }) {
  return (
    <div className="ft rv" style={{ transitionDelay: `${delay}ms` }}>
      <div className="ft-icon" style={{ background: tint }}>{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function Landing() {
  const s = useStore();
  const { t, lang, setLang } = useI18n();
  const cfg = s.config!;
  const root = useRef<HTMLDivElement>(null);
  const [school, setSchool] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<{ devLink?: string; sent: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const chosen = cfg.schools.find((x) => x.id === school);
  useReveal(root);

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
    <div className="lx" ref={root} onScroll={(e) => setScrolled((e.target as HTMLElement).scrollTop > 10)}>
      <nav className={`lx-nav ${scrolled ? "solid" : ""}`}>
        <div className="lx-logo"><span className="lx-mark"><i /><i /><i /><i /></span>Charlie on the MTA</div>
        <div className="lx-links">
          <button onClick={() => go("how")}>How it works</button>
          <button onClick={() => go("features")}>Features</button>
          <button onClick={() => go("live")}>Live T</button>
          <button onClick={() => go("safety")}>Safety</button>
        </div>
        <select className="lx-lang" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("language")}>
          {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <button className="lx-btn dark sm" onClick={() => go("start")}>Get started</button>
      </nav>

      <header className="lx-hero">
        <div className="lx-glow a" /><div className="lx-glow b" /><div className="lx-glow c" />
        <Doodle name="swan" size={84} className="dd float" style={{ top: 30, right: "46%" }} />
        <Doodle name="star" size={34} className="dd spin" style={{ top: 120, left: "2%" }} />
        <Doodle name="ducks" size={92} className="dd float slow" style={{ bottom: 10, left: "4%" }} />
        <Doodle name="coffee" size={58} className="dd wiggle" style={{ top: 70, right: "3%" }} />
        <Doodle name="sailboat" size={70} className="dd float" style={{ bottom: 40, right: "1%" }} />
        <div className="lx-hero-copy">
          <div className="lx-badge rv in"><span>New</span> Built at BostonHacks 2026 · Eats and Streets</div>
          <h1 className="rv in">Your first week in <span className="lx-hl">Boston</span>, <span className="lx-grad">one T stop at a time.</span></h1>
          <p className="lx-sub rv in">Cheap food and study spots you can reach by T right now, a safe way to find housing, and a game your whole school plays. Built for students who just got here.</p>
          <div className="lx-cta rv in">
            <button className="lx-btn dark" onClick={() => go("start")}>Start your first week →</button>
            {cfg.demoMode && cfg.personas[0] && (
              <button className="lx-btn light" disabled={busy} onClick={() => demo(cfg.personas[0].key)}>▶ Try the live demo</button>
            )}
          </div>
          <div className="lx-proof rv in">
            <div className="lx-avatars">{cfg.schools.slice(0, 5).map((x) => <span key={x.id} style={{ background: x.color }}>{x.short[0]}</span>)}</div>
            <span>For students at <b>Northeastern, BU, BC, UMass Boston, Harvard, MIT and Tufts</b></span>
          </div>
        </div>
        <div className="lx-hero-visual rv in"><PhonePreview /></div>
      </header>

      <div className="lx-strip">
        <span>Powered by</span>
        <b>Gemini</b><b>Mastra</b><b>Tiger Data</b><b>Vultr</b><b>MBTA live data</b><b>OpenStreetMap</b>
      </div>

      <section className="lx-stats">
        <div className="rv"><b><CountUp to={159720} root={root} /></b><span>students at Boston's colleges</span></div>
        <div className="rv" style={{ transitionDelay: "80ms" }}><b><CountUp to={80419} root={root} /></b><span>international students in Massachusetts</span></div>
        <div className="rv" style={{ transitionDelay: "160ms" }}><b><CountUp to={52} suffix="%" root={root} /></b><span>of students report high loneliness</span></div>
        <div className="rv" style={{ transitionDelay: "240ms" }}><b><CountUp to={490} suffix="+" root={root} /></b><span>Boston rental scam victims this year</span></div>
      </section>

      <BostonNow />

      <section id="how" className="lx-sec">
        <Doodle name="dome" size={70} className="dd-inline float" />
        <div className="lx-eyebrow rv">How it works</div>
        <h2 className="rv">From campus bubble to Bostonian in a week</h2>
        <div className="lx-steps">
          {[
            ["1", "Tell us where home is", "Pick your school, your home cuisine, language and budget. Takes 20 seconds."],
            ["2", "Go somewhere new", "Five first-week quests point to real places by T: a taste of home, a landmark, a study spot."],
            ["3", "Check in, collect, compete", "Snap a photo to collect the stop. Your school climbs a fair weekly board."],
          ].map(([n, h, p], i) => (
            <div key={n} className="lx-step rv" style={{ transitionDelay: `${i * 120}ms` }}>
              <span className="lx-num">{n}</span>
              <h3>{h}</h3>
              <p>{p}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="lx-sec">
        <Doodle name="brownstones" size={80} className="dd-inline float slow" />
        <div className="lx-eyebrow rv">Features</div>
        <h2 className="rv">Everything a new student needs, by T</h2>
        <div className="lx-features">
          <Feature icon="🍜" tint="#fff1e6" title="Food that fits your budget">Three spots under your budget at every station, filtered by craving, halal, vegetarian, and open past midnight.</Feature>
          <Feature icon="🧠" tint="#eef2ff" title="Search by meaning" delay={80}>Type “cozy dumplings, cheap” or “quiet place for coffee.” Gemini understands what you mean.</Feature>
          <Feature icon="📚" tint="#e9f9f1" title="Study spots near every stop" delay={160}>Libraries and wifi cafés, rated by students for outlets, noise and wifi.</Feature>
          <Feature icon="🗺️" tint="#fffbe0" title="A live map of the T" delay={0}>Every station, trains moving in real time, delays and shuttles, and quests to collect next.</Feature>
          <Feature icon="✨" tint="#fdecf3" title="A planner that checks its work" delay={80}>“$10, two hours, spicy, then somewhere quiet.” It checks hours, delays and budget before it suggests anything.</Feature>
          <Feature icon="☕" tint="#eaf6ff" title="Local spots, real rewards" delay={160}>Punch cards at independent spots, bonus points in their slow hours, verified redemptions.</Feature>
        </div>
      </section>

      <section id="live" className="lx-sec split">
        <div>
          <Doodle name="bridge" size={84} className="dd-inline float" />
          <div className="lx-eyebrow rv">Live data</div>
          <h2 className="rv">The T, right now</h2>
          <p className="lx-p rv">Charlie on the MTA reads the MBTA every 30 seconds and keeps the history, so it knows which lines run late and when. Shutdowns turn into bonus points instead of bad days.</p>
          <ul className="lx-list rv">
            <li>Live trains and alerts on the map</li>
            <li>A Chaos Score for every line</li>
            <li>A heads-up before your last train home</li>
          </ul>
        </div>
        <div className="rv"><LiveBoard /></div>
      </section>

      <section id="safety" className="lx-sec">
        <div className="lx-safety rv">
          <div>
            <div className="lx-eyebrow red">Safety</div>
            <h2>Rent without getting scammed</h2>
            <p className="lx-p">Paste any listing or a screenshot. We flag broker fees you may not owe under the 2025 Massachusetts law, and scam signs like “owner overseas” or “wire the deposit today,” then show you where to report it.</p>
          </div>
          <div className="lx-flags">
            {["💸 Broker fee you may not owe", "✈️ Owner is “overseas”", "🏧 Wire transfer requested", "🤔 Price far below the area"].map((f, i) => (
              <div key={f} className="lx-flag" style={{ animationDelay: `${i * 0.35}s` }}>{f}<span>High risk</span></div>
            ))}
          </div>
        </div>
      </section>

      <section className="lx-sec">
        <div className="lx-quote rv">
          <Doodle name="lobster" size={64} className="wiggle" />
          <p>“Priya landed from India in August. No car, $10 for dinner, and she'd never left campus. In her first week she found food that tasted like home, a library she loves, and the Orange Line.”</p>
          <span>The student we built this for</span>
        </div>
      </section>

      <section id="start" className="lx-sec">
        <div className="lx-start rv">
          <div className="lx-start-copy">
            <Doodle name="ducks" size={86} className="float" />
            <h2>Start your first week</h2>
            <p className="lx-p">Pick your school and sign in with your school email. The link goes to your real school inbox, so everyone here is a real student.</p>
            {cfg.demoMode && (
              <div className="lx-demo">
                {cfg.personas.map((p) => (
                  <button key={p.key} className="lx-btn light" disabled={busy} onClick={() => demo(p.key)}>
                    Try as {p.name.replace(" (demo)", "")} · {cfg.schools.find((x) => x.id === p.school)?.short}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="lx-form">
            <div className="lx-schools">
              {cfg.schools.map((x) => (
                <button key={x.id} className={`lx-school ${school === x.id ? "on" : ""}`} onClick={() => { setSchool(x.id); setEmail(email || `@${x.emailDomains[0]}`); }}>
                  <i style={{ background: x.color }} />{x.short}
                </button>
              ))}
            </div>
            {school && !sent && (
              <>
                <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`you@${chosen?.emailDomains[0]}`} aria-label="School email" />
                <button className="lx-btn dark wide" disabled={busy || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)} onClick={send}>Send my sign-in link</button>
              </>
            )}
            {!school && <div className="lx-hint">Choose your school to continue</div>}
            {sent && (
              <div className="lx-sent">
                ✓ Check your school inbox for the sign-in link.
                {sent.devLink && <a className="lx-btn dark wide" href={sent.devLink}>Open sign-in link (dev)</a>}
              </div>
            )}
            {err && <div className="lx-err">{err}</div>}
            <div className="lx-alt">
              <button onClick={() => s.setSignedOutBrowse(true)}>Just look around</button>
              <a href="/owner">I own a local spot →</a>
            </div>
          </div>
        </div>
      </section>

      <footer className="lx-foot">
        <div className="lx-logo"><span className="lx-mark"><i /><i /><i /><i /></span>Charlie on the MTA</div>
        <span>Built at BostonHacks 2026 · Map data © OpenStreetMap contributors · Transit data from the MBTA · Not affiliated with the MBTA or any school</span>
      </footer>
    </div>
  );
}
