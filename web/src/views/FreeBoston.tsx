/** $0 Boston: free places, broke-student day trails, and live Boston events (Meetup, Luma, Eventbrite, campus calendars). */
import { Fragment, useEffect, useMemo, useState } from "react";
import { api, fmtDist, haversine, money, qs } from "../api";
import { useStore } from "../store";
import { Sheet } from "../components/Sheet";

type Crew = "" | "solo" | "date" | "friends";
type When = "today" | "weekend" | "week";
interface Prefs { budget: number; crew: Crew; cats: string[]; diet: string; walk: boolean; indoor: boolean; seed: number | null; when: When; food: boolean; inPerson: boolean }

const PREFS_KEY = "lc-free-prefs";
const DEFAULT: Prefs = { budget: 0, crew: "", cats: [], diet: "", walk: false, indoor: false, seed: null, when: "week", food: false, inPerson: true };

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

const WALLET = [
  { v: 0, label: "Broke", icon: "🪙" },
  { v: 10, label: "Snack money", icon: "🥨" },
  { v: 25, label: "Treat day", icon: "🍦" },
  { v: 40, label: "Payday", icon: "💸" },
];
const walletMood = (b: number) => (b === 0 ? "Zero dollars, full day. Watch." : b <= 10 ? "Enough for a snack and a story." : b <= 25 ? "Lunch, a treat and a museum. Fancy." : "Basically a tourist with a student ID.");

const CREW: { id: Crew; label: string; icon: string }[] = [
  { id: "", label: "Anyone", icon: "✨" },
  { id: "solo", label: "Solo", icon: "🎧" },
  { id: "date", label: "Date", icon: "💞" },
  { id: "friends", label: "Friends", icon: "👯" },
];
const DIETS = [["", "Any food"], ["halal", "Halal"], ["vegetarian", "Vegetarian"], ["vegan", "Vegan"], ["gluten_free", "Gluten-free"], ["kosher", "Kosher"]] as const;

const SOURCE: Record<string, { label: string; color: string }> = {
  meetup: { label: "Meetup", color: "#ED1C40" },
  luma: { label: "Luma", color: "#a78bfa" },
  eventbrite: { label: "Eventbrite", color: "#F05537" },
  campus: { label: "Campus", color: "#3ddc97" },
};
const TAG_ICON: Record<string, string> = { tech: "💻", career: "🤝", social: "🎲", arts: "🎨", music: "🎶", outdoors: "🌳", food: "🍜", wellness: "🧘", learning: "🎓" };

const hrs = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);
const price = (c: number) => (c === 0 ? "FREE" : money(c));
const evPrice = (e: any) => (e.free === true ? "FREE" : e.priceCents != null ? money(e.priceCents) : "Price not listed");
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).replace(":00", "");
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const dayLabel = (iso: string) => {
  const k = dayKey(iso), today = dayKey(new Date().toISOString()), tmr = dayKey(new Date(Date.now() + 86_400_000).toISOString());
  if (k === today) return "Today";
  if (k === tmr) return "Tomorrow";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" });
};

function LinePill({ l }: { l: { short: string; color: string } }) {
  return <span className="fb-line" style={{ background: l.color }}>{l.short.replace("Green ", "")}</span>;
}

export function FreeBostonView() {
  const s = useStore();
  const [p, setP] = useState<Prefs>(() => read(PREFS_KEY, DEFAULT));
  const [tab, setTab] = useState<"trail" | "all" | "events">("trail");
  const [d, setD] = useState<any>(null);
  const [ev, setEv] = useState<any>(null);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [spinKey, setSpinKey] = useState(0);
  const [evQ, setEvQ] = useState("");
  const [evQd, setEvQd] = useState("");
  useEffect(() => { const t = setTimeout(() => setEvQd(evQ.trim()), 300); return () => clearTimeout(t); }, [evQ]);

  const update = (patch: Partial<Prefs>) => setP((o) => { const n = { ...o, ...patch }; write(PREFS_KEY, n); return n; });

  const lat = s.pos ? +s.pos.lat.toFixed(3) : undefined, lon = s.pos ? +s.pos.lon.toFixed(3) : undefined;
  useEffect(() => {
    setLoading(true);
    setErr(null);
    api.get(`/free-boston?${qs({ budget: p.budget, crew: p.crew, cats: p.cats.join(","), diet: p.budget > 0 ? p.diet : "", walk: p.walk ? 1 : "", indoor: p.indoor ? 1 : "", seed: p.seed ?? undefined, lat, lon })}`)
      .then(setD).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, [p.budget, p.crew, p.cats.join(","), p.diet, p.walk, p.indoor, p.seed, lat, lon]);

  useEffect(() => {
    setEvErr(null);
    api.get(`/boston-events?${qs({ budget: p.budget, when: p.when, crew: p.crew, food: p.food ? 1 : "", inPerson: p.inPerson ? 1 : "", q: evQd, lat, lon, limit: 60 })}`)
      .then(setEv).catch((e) => setEvErr(e.message));
  }, [p.budget, p.when, p.crew, p.food, p.inPerson, evQd, lat, lon]);

  const go = (x: { stationId: string; lat: number; lon: number }) => {
    s.setPanel(null);
    s.openStation(x.stationId);
    s.flyTo(x.lat, x.lon, 16.2);
  };
  const spin = () => { update({ seed: Math.floor(Math.random() * 1e9) }); setSpinKey((k) => k + 1); setTab("trail"); };

  const trail = d?.trail;

  // events happening today within a 15-minute walk of any trail stop
  const nearTrail = useMemo(() => {
    if (!trail || !ev?.events) return [];
    const today = dayKey(new Date().toISOString());
    return ev.events
      .filter((e: any) => e.lat != null && !e.online && dayKey(e.start) === today)
      .map((e: any) => {
        const best = trail.stops.map((st: any) => ({ st, m: haversine(st.lat, st.lon, e.lat, e.lon) })).sort((a: any, b: any) => a.m - b.m)[0];
        return { e, st: best.st, m: best.m };
      })
      .filter((x: any) => x.m <= 1200)
      .slice(0, 2);
  }, [trail, ev]);

  const share = async () => {
    if (!trail) return;
    const text = [
      `My $0 Boston day (${price(trail.spentCents)} spent, ~${hrs(trail.minutes)}):`,
      ...trail.stops.map((x: any, i: number) => `${i + 1}. ${x.name}${x.station ? ` (T: ${x.station})` : ""}`),
      trail.meal ? `🍴 ${trail.meal.name}` : "",
      ...nearTrail.map((x: any) => `🎉 ${x.e.title}, ${clock(x.e.start)}${x.e.url ? ` ${x.e.url}` : ""}`),
      "Made with Line Collector",
    ].filter(Boolean).join("\n");
    try {
      if (navigator.share) await navigator.share({ title: "My $0 Boston day", text });
      else { await navigator.clipboard.writeText(text); s.toast("Trail copied. Send it to the group chat"); }
    } catch { /* cancelled */ }
  };

  return (
    <Sheet title={<span className="fb-title">💸 $0 Boston</span>} sub="Broke, not bored. Free places, cheap eats and what's on in the city." onClose={() => s.setPanel(null)} full>
      {/* ---- wallet ---- */}
      <div className="fb-wallet">
        <div className="row between">
          <div>
            <div className="tiny fb-eyebrow">IN MY WALLET TODAY</div>
            <div className="fb-amount">${p.budget}</div>
          </div>
          <div className="fb-coin" aria-hidden>{WALLET.slice().reverse().find((w) => p.budget >= w.v)?.icon}</div>
        </div>
        <input className="fb-slider" type="range" min={0} max={40} step={1} value={p.budget} aria-label="Budget in dollars" onChange={(e) => update({ budget: +e.target.value })} />
        <div className="chips">
          {WALLET.map((w) => (
            <button key={w.v} className={`chip ${p.budget === w.v ? "on" : ""}`} onClick={() => update({ budget: w.v })}>{w.icon} ${w.v} · {w.label}</button>
          ))}
        </div>
        <div className="small fb-mood">{walletMood(p.budget)}</div>
      </div>

      {/* ---- who ---- */}
      <div className="field">
        <label>Who's coming?</label>
        <div className="seg">
          {CREW.map((c) => <button key={c.id} className={p.crew === c.id ? "on" : ""} onClick={() => update({ crew: c.id })}>{c.icon} {c.label}</button>)}
        </div>
      </div>

      {/* ---- tabs ---- */}
      <div className="seg" role="tablist">
        <button className={tab === "trail" ? "on" : ""} onClick={() => setTab("trail")}>🎟️ Day trail</button>
        <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>📍 Places {d ? `(${d.total})` : ""}</button>
        <button className={tab === "events" ? "on" : ""} onClick={() => setTab("events")}>🎉 Events {ev ? `(${ev.total})` : ""}</button>
      </div>

      {/* place filters (trail + places) */}
      {tab !== "events" && (
        <>
          <div className="field">
            <label>What are you in the mood for? <span className="muted">(pick any)</span></label>
            <div className="chips" style={{ flexWrap: "wrap" }}>
              {(d?.cats ?? []).map((c: any) => (
                <button key={c.id} className={`chip ${p.cats.includes(c.id) ? "on" : ""}`} onClick={() => update({ cats: p.cats.includes(c.id) ? p.cats.filter((x) => x !== c.id) : [...p.cats, c.id] })}>{c.icon} {c.label}</button>
              ))}
              {p.cats.length > 0 && <button className="chip ghost" onClick={() => update({ cats: [] })}>✕ clear</button>}
            </div>
          </div>
          {p.budget > 0 && (
            <div className="field">
              <label>Food preference (for the cheap eats along the way)</label>
              <div className="chips">
                {DIETS.map(([id, label]) => <button key={id} className={`chip ${p.diet === id ? "on" : ""}`} onClick={() => update({ diet: id })}>{label}</button>)}
              </div>
            </div>
          )}
          <div className="row wrap">
            <label className="fb-toggle"><input type="checkbox" checked={p.walk} onChange={(e) => update({ walk: e.target.checked })} /> 🚶 Walk only (no T fare)</label>
            <label className="fb-toggle"><input type="checkbox" checked={p.indoor} onChange={(e) => update({ indoor: e.target.checked })} /> ☔ Indoor only</label>
          </div>
          {d?.weather?.rainy && !p.indoor && (
            <div className="banner info row between">
              <span>🌧️ It's {Math.round(d.weather.feelsLikeF ?? d.weather.tempF)}°F and grim out there.</span>
              <button className="btn sm" onClick={() => update({ indoor: true })}>Go indoor</button>
            </div>
          )}
        </>
      )}

      {err && tab !== "events" && <div className="error">{err}</div>}
      {loading && !d && tab !== "events" && <div className="muted center">Finding free stuff…</div>}

      {tab === "trail" && d && (
        trail ? (
          <div key={spinKey} className="fb-ticket">
            <div className="fb-ticket-head">
              <div>
                <div className="tiny fb-eyebrow">TODAY'S RIDE {trail.seed ? `· #${String(trail.seed).slice(-4)}` : "· from where you are"}</div>
                <div className="fb-ticket-cost"><b>{price(trail.spentCents)}</b> <span className="muted small">of ${p.budget}</span></div>
              </div>
              <div className="fb-ticket-stats">
                <span>⏱ ~{hrs(trail.minutes)}</span>
                <span>🚶 {trail.walkKm} km</span>
                <span>🚇 {trail.rides ? `${trail.rides} ride${trail.rides > 1 ? "s" : ""}` : "no T"}</span>
              </div>
            </div>
            <div className="fb-perf" />
            <ol className="fb-timeline">
              {trail.stops.map((x: any, i: number) => {
                const leg = trail.legs[i];
                const treat = trail.treats.find((t: any) => t.stopId === x.id);
                const color = x.lines[0]?.color ?? "var(--accent)";
                return (
                  <Fragment key={x.id}>
                    <li className="fb-stop" style={{ ["--c" as any]: color }}>
                      <div className="fb-dot">{i + 1}</div>
                      <div className="grow">
                        <div className="row between" style={{ alignItems: "flex-start" }}>
                          <div className="grow">
                            <b>{x.name}</b>
                            <div className="tiny muted">{x.station && <>T: {x.station} {x.lines.slice(0, 2).map((l: any) => <LinePill key={l.id} l={l} />)} · </>}~{hrs(x.minutes)}{i === trail.stops.length - 1 && x.sunset && " · 🌅 end at sunset"}</div>
                          </div>
                          <span className={`fb-price ${x.costCents ? "" : "free"}`}>{price(x.costCents)}</span>
                        </div>
                        <div className="small fb-hack">💡 {x.hack}</div>
                        {treat && <div className="tiny fb-treat">🍬 Treat: {treat.label} · {money(treat.cents)}</div>}
                        <div className="row" style={{ marginTop: 6 }}>
                          <button className="btn sm primary" onClick={() => go(x)}>Go</button>
                        </div>
                      </div>
                    </li>
                    {trail.meal && trail.meal.afterStop === i && <MealRow m={trail.meal} />}
                    {leg && (
                      <li className="fb-leg">
                        {leg.mode === "ride" && leg.ride
                          ? <>🚇 {leg.ride.lines.map((l: any) => <LinePill key={l.id} l={l} />)} {leg.ride.from} → {leg.ride.to}{!leg.ride.direct && " (transfer)"} · ~{leg.minutes} min</>
                          : <>🚶 {leg.minutes} min walk · {fmtDist(leg.distanceM)}</>}
                      </li>
                    )}
                  </Fragment>
                );
              })}
            </ol>
            {nearTrail.length > 0 && (
              <div className="fb-tonight">
                <div className="tiny fb-eyebrow">🎉 ALSO HAPPENING NEAR YOUR TRAIL TODAY</div>
                {nearTrail.map((x: any) => (
                  <a key={x.e.id} className="fb-tonight-row" href={x.e.url ?? undefined} target="_blank" rel="noopener noreferrer">
                    <b>{clock(x.e.start)}</b>
                    <span className="grow">{x.e.title}<span className="tiny muted"> · {Math.round(x.m / 80)} min from {x.st.name}</span></span>
                    <span className={`fb-price ${x.e.free ? "free" : ""}`}>{evPrice(x.e)}</span>
                  </a>
                ))}
              </div>
            )}
            {p.budget > 0 && !trail.meal && <div className="tiny muted fb-picnic">🍴 No {p.diet ? DIETS.find(([id]) => id === p.diet)?.[1].toLowerCase() + " " : ""}spot under ${p.budget} is open along this trail right now. Spin again, or check the cheap eats on the Places tab.</div>}
            {p.budget === 0 && <div className="tiny muted fb-picnic">🥪 $0 tip: pack a sandwich from home and eat it at stop {Math.max(1, Math.ceil(trail.stops.length / 2))}. Best free lunch view in Boston.</div>}
            <div className="row" style={{ padding: "0 14px 14px" }}>
              <button className="btn primary grow fb-spin" onClick={spin}>🎲 Spin another day</button>
              <button className="btn" onClick={share} aria-label="Share trail">📤</button>
            </div>
          </div>
        ) : (
          <div className="card center">
            <div style={{ fontSize: 36 }}>🤷</div>
            Nothing fits all of those filters. Try fewer place types, or turn off Walk only.
          </div>
        )
      )}

      {tab === "all" && d && (
        <div className="list">
          {d.places.map((x: any) => <PlaceCard key={x.id} x={x} onGo={() => go(x)} budget={p.budget} />)}
          {!d.places.length && <div className="card center muted">No places match. Loosen a filter.</div>}
        </div>
      )}

      {tab === "events" && (
        <EventsTab ev={ev} err={evErr} p={p} update={update} query={evQ} setQuery={setEvQ} onGo={(e) => { s.setPanel(null); if (e.station) s.openStation(e.station.id); s.flyTo(e.lat, e.lon, 16); }} />
      )}

      {/* ---- hacks ---- */}
      {d?.hacks && tab !== "events" && (
        <div className="field">
          <label>Broke-student cheat codes</label>
          <div className="fb-hacks">
            {d.hacks.map((h: any) => (
              <div key={h.title} className="card fb-hackcard">
                <div style={{ fontSize: 26 }}>{h.icon}</div>
                <b className="small">{h.title}</b>
                <div className="tiny muted">{h.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="tiny muted">Prices and free-entry rules change. Anything marked ⚠️ is worth checking before you go. Food prices are estimates from OpenStreetMap ("est."). Events come from each organizer's public feed. Check the event page before you head out.</div>
    </Sheet>
  );
}

const QUICK: [string, string][] = [["🎶", "live music"], ["🍕", "free food"], ["💻", "hackathon"], ["🎨", "art"], ["🎤", "open mic"], ["🏃", "run club"], ["🎲", "game night"], ["🧘", "yoga"]];

/** The same search, opened on each site. Plain links: always work, no API needed. */
function deepLinks(q: string, when: When) {
  const t = q.trim();
  const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const whenText = when === "today" ? "today" : when === "weekend" ? "this weekend" : "this week";
  return [
    { label: "Eventbrite", color: SOURCE.eventbrite.color, href: `https://www.eventbrite.com/d/ma--boston/${slug}/` },
    { label: "Meetup", color: SOURCE.meetup.color, href: `https://www.meetup.com/find/?keywords=${encodeURIComponent(t)}&location=us--ma--Boston&source=EVENTS` },
    { label: "Luma", color: SOURCE.luma.color, href: "https://lu.ma/boston" },
    { label: "Google", color: "#5ab0ff", href: `https://www.google.com/search?q=${encodeURIComponent(`${t} events in Boston ${whenText}`)}` },
  ];
}

function EventsTab({ ev, err, p, update, query, setQuery, onGo }: { ev: any; err: string | null; p: Prefs; update: (x: Partial<Prefs>) => void; query: string; setQuery: (q: string) => void; onGo: (e: any) => void }) {
  const [showSources, setShowSources] = useState(false);
  const [web, setWeb] = useState<any>(null);
  const [webState, setWebState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [webErr, setWebErr] = useState<{ msg: string; noKey: boolean } | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const e of ev?.events ?? []) { const k = dayKey(e.start); if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); }
    return [...m.values()];
  }, [ev]);
  const live = (ev?.sources ?? []).filter((x: any) => x.ok);
  const hasQuery = query.trim().length >= 2;

  const searchWeb = async (term = query) => {
    const t = term.trim();
    if (t.length < 2) return;
    setWebState("loading");
    setWebErr(null);
    try {
      setWeb(await api.get(`/boston-events/search?${qs({ q: t, when: p.when, budget: p.budget })}`));
      setWebState("done");
    } catch (e: any) {
      setWebErr({ msg: e.message, noKey: e.status === 503 });
      setWebState("error");
    }
  };

  return (
    <>
      <form className="fb-search" onSubmit={(e) => { e.preventDefault(); searchWeb(); }} role="search">
        <input className="input" type="search" enterKeyHint="search" placeholder="Search Boston: jazz, hackathon, pottery…" aria-label="Search Boston events"
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn primary" type="submit" disabled={!hasQuery || webState === "loading"} aria-label="Search the web">🔎</button>
      </form>
      <div className="chips">
        {QUICK.map(([icon, term]) => (
          <button key={term} className={`chip ${query === term ? "on" : ""}`} onClick={() => { setQuery(term); searchWeb(term); }}>{icon} {term}</button>
        ))}
      </div>
      {hasQuery && (
        <div className="row wrap tiny">
          <span className="muted">Open this search on</span>
          {deepLinks(query, p.when).map((l) => (
            <a key={l.label} className="fb-deeplink" style={{ borderColor: l.color }} href={l.href} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
          ))}
        </div>
      )}

      {webState !== "idle" && (
        <div className="fb-web">
          <div className="row between">
            <div className="tiny fb-eyebrow">🌐 AROUND BOSTON ON THE WEB{web?.query && webState === "done" ? ` · "${web.query}"` : ""}</div>
            {web?.cached && webState === "done" && <span className="tiny muted">saved search</span>}
          </div>
          {webState === "loading" && <div className="fb-web-loading small"><span className="fb-pulse" /> Searching Google for "{query.trim()}"…</div>}
          {webState === "error" && webErr && (
            <div className="small muted">{webErr.noKey ? "Web search turns on once the server has a GEMINI_API_KEY. Until then, open this search on the sites above." : webErr.msg}</div>
          )}
          {webState === "done" && web && (
            <>
              {!web.verified && web.events.length > 0 && <div className="banner warn tiny">Gemini couldn't tie these to specific pages. Check the sources before you go.</div>}
              {web.events.map((e: any, i: number) => <WebEventCard key={`${e.title}-${i}`} e={e} />)}
              {!web.events.length && <div className="small muted">Nothing found for that time window. Try "Next 7 days" or a broader word.</div>}
              {web.suggestionsHtml && (
                <iframe className="fb-suggest" title="Google Search suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={`<base target="_blank">${web.suggestionsHtml}`} />
              )}
              {web.sources.length > 0 && (
                <div className="row wrap tiny">
                  <span className="muted">Sources</span>
                  {web.sources.map((x: any) => <a key={x.uri} className="fb-deeplink" href={x.uri} target="_blank" rel="noopener noreferrer">{x.title}</a>)}
                </div>
              )}
              <div className="tiny muted">Found by Gemini with Google Search. AI can get dates wrong, so open the event page before you head out.</div>
            </>
          )}
        </div>
      )}

      {hasQuery && ev && <div className="tiny fb-eyebrow">📡 FROM OUR FEEDS · {ev.total} match{ev.total === 1 ? "" : "es"}</div>}
      <div className="seg">
        {(["today", "weekend", "week"] as When[]).map((w) => (
          <button key={w} className={p.when === w ? "on" : ""} onClick={() => update({ when: w })}>{w === "today" ? "Tonight" : w === "weekend" ? "This weekend" : "Next 7 days"}</button>
        ))}
      </div>
      <div className="row wrap">
        <label className="fb-toggle"><input type="checkbox" checked={p.food} onChange={(e) => update({ food: e.target.checked })} /> 🍕 Free food</label>
        <label className="fb-toggle"><input type="checkbox" checked={p.inPerson} onChange={(e) => update({ inPerson: e.target.checked })} /> 📍 In person</label>
      </div>
      <div className="tiny muted">
        {p.budget === 0 ? "Showing free events and ones with no price listed." : `Showing free events and anything up to $${p.budget}.`}
        {p.crew && " Picks that suit your crew come first."}
      </div>

      {err && <div className="error">{err}</div>}
      {!ev && !err && <div className="muted center">Checking Meetup, Luma, Eventbrite and campus calendars…</div>}

      {ev && groups.map((list) => (
        <div key={dayKey(list[0].start)} className="col" style={{ gap: 8 }}>
          <div className="fb-day">{dayLabel(list[0].start)}</div>
          {list.map((e: any) => <EventCard key={e.id} e={e} onGo={onGo} />)}
        </div>
      ))}
      {ev && !ev.total && (
        <div className="card center">
          <div style={{ fontSize: 36 }}>🗓️</div>
          {hasQuery
            ? <>None of our feeds mention "{query.trim()}". {webState === "idle" ? <button className="btn sm" onClick={() => searchWeb()}>🔎 Search the web</button> : "Check the web results above."}</>
            : <>No events match right now. Try "Next 7 days" or turn off Free food.</>}
        </div>
      )}

      {ev && (
        <div className="card tight">
          <button className="row between fb-srcbtn" onClick={() => setShowSources(!showSources)}>
            <span className="small">📡 {live.length} of {ev.sources.length} feeds live · updated {clock(ev.fetchedAt)}</span>
            <span className="tiny muted">{showSources ? "hide" : "details"}</span>
          </button>
          {showSources && (
            <div className="col" style={{ gap: 4, marginTop: 8 }}>
              {ev.sources.map((x: any) => (
                <div key={x.source + x.name} className="row tiny">
                  <span className="fb-src" style={{ background: SOURCE[x.source]?.color }}>{SOURCE[x.source]?.label}</span>
                  <span className="grow">{x.name}</span>
                  <span className={x.ok ? "" : "muted"}>{x.ok ? `${x.count} events` : x.error}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function EventCard({ e, onGo }: { e: any; onGo: (e: any) => void }) {
  const src = SOURCE[e.source] ?? { label: e.source, color: "#888" };
  const d = new Date(e.start);
  return (
    <div className="card fb-event">
      <div className="fb-cal" style={{ borderColor: src.color }}>
        <span>{d.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" }).toUpperCase()}</span>
        <b>{d.toLocaleDateString("en-US", { day: "numeric", timeZone: "America/New_York" })}</b>
        <span>{clock(e.start)}</span>
      </div>
      <div className="grow col" style={{ gap: 4 }}>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <b className="grow">{e.title}</b>
          <span className={`fb-price ${e.free ? "free" : ""}`}>{evPrice(e)}</span>
        </div>
        <div className="tiny muted">
          <span className="fb-src" style={{ background: src.color }}>{src.label}</span> {e.sourceName}
        </div>
        <div className="tiny muted">
          {e.online ? "💻 Online" : <>📍 {e.venue ?? e.address ?? "Location on event page"}</>}
          {e.station && <> · T: {e.station.name} {e.station.lines.slice(0, 2).map((l: any) => <LinePill key={l.id} l={l} />)} · {fmtDist(e.station.distanceM)} walk</>}
          {e.distanceM != null && <> · {fmtDist(e.distanceM)} from you</>}
        </div>
        <div className="row wrap" style={{ gap: 4 }}>
          {e.freeFood && <span className="tag gold">🍕 free food</span>}
          {e.tags.slice(0, 3).map((t: string) => <span key={t} className="tag">{TAG_ICON[t] ?? "•"} {t}</span>)}
        </div>
        <div className="row" style={{ marginTop: 2 }}>
          {e.url && <a className="btn sm primary" href={e.url} target="_blank" rel="noopener noreferrer">Open on {src.label} ↗</a>}
          {e.lat != null && !e.online && <button className="btn sm ghost" onClick={() => onGo(e)}>Show on map</button>}
        </div>
      </div>
    </div>
  );
}

function WebEventCard({ e }: { e: any }) {
  const link: string | null = e.url ?? e.sources?.[0]?.uri ?? null;
  let site: string | null = e.sources?.[0]?.title ?? null;
  if (e.url) { try { site = new URL(e.url).hostname.replace(/^www\./, ""); } catch { /* keep source title */ } }
  // noon in Boston, so the weekday never shifts with the viewer's time zone
  const d = e.date ? new Date(Date.UTC(+e.date.slice(0, 4), +e.date.slice(5, 7) - 1, +e.date.slice(8, 10), 17)) : null;
  const fmt = (o: Intl.DateTimeFormatOptions) => d!.toLocaleDateString("en-US", { ...o, timeZone: "America/New_York" });
  return (
    <div className="card fb-event">
      <div className="fb-cal" style={{ borderColor: "#5ab0ff" }}>
        {d ? <><span>{fmt({ weekday: "short" }).toUpperCase()}</span><b>{fmt({ day: "numeric" })}</b><span>{e.time ?? ""}</span></> : <b>?</b>}
      </div>
      <div className="grow col" style={{ gap: 4 }}>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <b className="grow">{e.title}</b>
          <span className={`fb-price ${e.free ? "free" : ""}`}>{e.free ? "FREE" : e.price ?? "Price not listed"}</span>
        </div>
        <div className="tiny muted">📍 {[e.venue, e.neighborhood].filter(Boolean).join(" · ") || "Location on event page"}</div>
        {e.why && <div className="small">{e.why}</div>}
        {link && <div className="row"><a className="btn sm primary" href={link} target="_blank" rel="noopener noreferrer">Open {site ?? "page"} ↗</a></div>}
      </div>
    </div>
  );
}

function MealRow({ m }: { m: any }) {
  return (
    <li className="fb-meal">
      🍴 <b>Refuel: {m.name}</b> · {money(m.priceCents)}{m.priceSource === "estimate" && " est."}{m.cheapestItem && ` (${m.cheapestItem})`}
      {m.diet?.length > 0 && <span className="tiny"> · {m.diet.map((x: string) => x.replace("_", "-")).join(", ")}</span>}
      {m.localOwned && <span className="tiny"> · local</span>}
    </li>
  );
}

const CAT_ICON: Record<string, string> = { park: "🌳", museum: "🖼️", campus: "🎓", view: "🌇", library: "📚", landmark: "🏛️", market: "🛍️" };

function PlaceCard({ x, onGo, budget }: { x: any; onGo: () => void; budget: number }) {
  return (
    <div className="card col fb-card">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="fb-caticon">{CAT_ICON[x.cat]}</div>
        <div className="grow">
          <b>{x.name}</b>
          <div className="tiny muted">
            {x.station && <>T: {x.station} {x.lines.slice(0, 3).map((l: any) => <LinePill key={l.id} l={l} />)}</>}
            {x.distanceM != null && <> · {fmtDist(x.distanceM)} away</>}
          </div>
        </div>
        <span className={`fb-price ${x.costCents ? "" : "free"}`}>{price(x.costCents)}</span>
      </div>
      <div className="small">{x.blurb}</div>
      <div className="tiny muted">{x.costNote}</div>
      <div className="small fb-hack">💡 {x.hack}</div>
      {x.check && <div className="tiny fb-check">⚠️ {x.check}</div>}
      <div className="row wrap">
        {x.sunset && <span className="tag gold">🌅 sunset spot</span>}
        {x.indoor && <span className="tag">☔ indoor</span>}
        {x.crew.includes("date") && <span className="tag">💞 date-worthy</span>}
        {x.crew.includes("friends") && <span className="tag">👯 group-friendly</span>}
      </div>
      {budget > 0 && x.eat && (
        <div className="fb-eat small">🍴 Cheap eat nearby: <b>{x.eat.name}</b> · {money(x.eat.priceCents)}{x.eat.priceSource === "estimate" && " est."} · {x.eat.walkMin} min walk</div>
      )}
      <div className="row">
        <button className="btn sm primary" onClick={onGo}>Go</button>
      </div>
    </div>
  );
}
