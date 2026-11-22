import { useState } from "react";
import { api, qs } from "../api";
import { useI18n } from "../i18n";
import { useStore } from "../store";
import { Sheet } from "../components/Sheet";

// The planner reads plain text ("$10, two hours, spicy food, then somewhere quiet to study"),
// so these controls write that sentence for the student instead of making them type it.
const FOODS: { id: string; label: string; words: string }[] = [
  { id: "", label: "✨ Anything", words: "" },
  { id: "spicy", label: "🌶️ Spicy", words: "spicy food" },
  { id: "noodles", label: "🍜 Noodles", words: "noodles" },
  { id: "pizza", label: "🍕 Pizza", words: "pizza" },
  { id: "sandwich", label: "🥪 Sandwich", words: "sandwich" },
  { id: "burger", label: "🍔 Burgers", words: "burgers" },
  { id: "coffee", label: "☕ Coffee", words: "coffee" },
  { id: "sweet", label: "🍩 Sweet", words: "something sweet" },
  { id: "home", label: "🏡 Taste of home", words: "taste of home" },
  { id: "halal", label: "Halal", words: "halal food" },
  { id: "vegetarian", label: "Vegetarian", words: "vegetarian food" },
  { id: "vegan", label: "Vegan", words: "vegan food" },
];

const NEXT: { id: "study" | "late" | "rent"; label: string; words: string }[] = [
  { id: "study", label: "📚 Quiet study spot", words: "then somewhere quiet to study" },
  { id: "late", label: "🌙 Open late", words: "open late" },
  { id: "rent", label: "🏠 Rent check", words: "and is rent cheap around there?" },
];

const HOURS = [1, 2, 3];

const EXPLORE: { id: string; label: string }[] = [
  { id: "park", label: "🌳 Parks" },
  { id: "view", label: "🌇 River & skyline views" },
  { id: "landmark", label: "🏛️ Landmarks & history" },
  { id: "museum", label: "🖼️ Museums" },
  { id: "campus", label: "🎓 Campuses" },
  { id: "library", label: "📚 Libraries" },
  { id: "market", label: "🛍️ Markets" },
];
const CAT_ICON: Record<string, string> = { park: "🌳", view: "🌇", landmark: "🏛️", museum: "🖼️", campus: "🎓", library: "📚", market: "🛍️" };

export function buildPlanQuery(o: { budget: number; hours: number; food: string; next: string[] }) {
  const food = FOODS.find((f) => f.id === o.food)?.words;
  return [
    `$${o.budget}`,
    `${o.hours} hour${o.hours > 1 ? "s" : ""}`,
    food,
    ...NEXT.filter((n) => o.next.includes(n.id)).map((n) => n.words),
  ].filter(Boolean).join(", ");
}

function ExploreCard({ x, onGo }: { x: any; onGo: () => void }) {
  const h = x.hours;
  const status = h.allDay ? <span className="tag ok">Open 24 hours</span>
    : h.openNow === true ? <span className="tag ok">Open now</span>
    : h.openNow === false ? <span className="tag">Closed now</span>
    : null;
  return (
    <div className="card col" style={{ gap: 6 }}>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <b>{CAT_ICON[x.cat] ?? "📍"} {x.name}</b>
          <div className="tiny muted">
            {x.walkMin <= 25 ? `${x.walkMin} min walk` : `${(x.distanceM / 1000).toFixed(1)} km · take the T`}{x.station && <> · T: {x.station} {x.lines.slice(0, 2).map((l: any) => <span key={l.id} className="fb-line" style={{ background: l.color }}>{l.short.replace("Green ", "")}</span>)}</>}
          </div>
        </div>
        {status}
      </div>
      {(h.today || h.next) && (
        <div className="small">🕒 {h.allDay ? "Open all day" : <>Today: <b>{h.today}</b></>}{h.next && !h.allDay && <span className="muted"> · {h.next}</span>}</div>
      )}
      {h.note && <div className="tiny muted">{h.note}</div>}
      <div className="small muted">{x.blurb}</div>
      <div className="row between">
        <span className="tiny muted">{x.costNote ?? (x.costCents === 0 ? "Free" : `About $${Math.round(x.costCents / 100)}`)}</span>
        <button className="btn sm primary" onClick={onGo}>Go</button>
      </div>
    </div>
  );
}

export function PlanView() {
  const s = useStore();
  const { t } = useI18n();
  const [budget, setBudget] = useState(() => Math.min(30, Math.max(5, Math.round((s.me?.user?.budgetCents ?? 1000) / 100))));
  const [hours, setHours] = useState(2);
  const [food, setFood] = useState("");
  const [next, setNext] = useState<string[]>(["study"]);
  const [explore, setExplore] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [spots, setSpots] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    setRes(null);
    setSpots(null);
    const where = { lat: s.pos?.lat, lon: s.pos?.lon };
    // the stop plan and the explore list don't depend on each other, so ask for both at once
    const [plan, nearby] = await Promise.allSettled([
      api.get(`/plan?${qs({ q: buildPlanQuery({ budget, hours, food, next }), ...where })}`),
      explore.length ? api.get(`/explore-nearby?${qs({ cats: explore.join(","), limit: 6, ...where })}`) : Promise.resolve(null),
    ]);
    if (plan.status === "fulfilled") setRes(plan.value);
    else setErr((plan.reason as Error).message);
    if (nearby.status === "fulfilled" && nearby.value) setSpots(nearby.value.places);
    setBusy(false);
  };
  const goTo = (x: { stationId: string; lat: number; lon: number }) => {
    s.setPanel(null);
    s.openStation(x.stationId);
    s.flyTo(x.lat, x.lon, 16.2);
  };
  const show = (stationId: string) => {
    const st = s.stationById.get(stationId);
    s.openStation(stationId);
    if (st) s.flyTo(st.lat, st.lon, 15.5);
  };
  const toggleNext = (id: string) => setNext((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));

  return (
    <Sheet title={`✨ ${t("planTitle")}`} sub="Pick your budget and what you're after. We'll plan the stop." onClose={() => s.setPanel(null)} full>
      <div className="field">
        <div className="row between">
          <label htmlFor="plan-budget">Budget</label>
          <b style={{ fontSize: 22, color: "var(--accent)" }}>${budget}</b>
        </div>
        <input id="plan-budget" type="range" min={5} max={30} step={1} value={budget} onChange={(e) => setBudget(+e.target.value)}
          style={{ width: "100%", accentColor: "var(--accent)", height: 28 }} aria-valuetext={`$${budget}`} />
        <div className="row between tiny muted"><span>$5</span><span>$30</span></div>
      </div>

      <div className="field">
        <label>How long do you have?</label>
        <div className="seg">
          {HOURS.map((h) => <button key={h} className={hours === h ? "on" : ""} onClick={() => setHours(h)}>{h} hr{h > 1 ? "s" : ""}</button>)}
        </div>
      </div>

      <div className="field">
        <label>What do you feel like eating?</label>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {FOODS.map((f) => <button key={f.id} className={`chip ${food === f.id ? "on" : ""}`} onClick={() => setFood(f.id)}>{f.label}</button>)}
        </div>
      </div>

      <div className="field">
        <label>Where next? <span className="muted">(pick any)</span></label>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {NEXT.map((n) => <button key={n.id} className={`chip ${next.includes(n.id) ? "on" : ""}`} onClick={() => toggleNext(n.id)}>{n.label}</button>)}
        </div>
      </div>

      <div className="field">
        <label>What would you like to explore today? <span className="muted">(pick any)</span></label>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {EXPLORE.map((x) => (
            <button key={x.id} className={`chip ${explore.includes(x.id) ? "on" : ""}`}
              onClick={() => setExplore((o) => (o.includes(x.id) ? o.filter((v) => v !== x.id) : [...o, x.id]))}>{x.label}</button>
          ))}
        </div>
      </div>

      <button className="btn primary block" disabled={busy} onClick={run}>{busy ? "Planning…" : `✨ ${t("planGo")}`}</button>
      {err && <div className="banner danger">{err}</div>}
      {res && (
        <div className="card hero">
          <div style={{ whiteSpace: "pre-wrap", fontSize: 16 }}>{res.text || "No plan returned."}</div>
          {res.stops.length > 0 && (
            <div className="row wrap" style={{ marginTop: 10 }}>
              {res.stops.map((x: any) => (
                <button key={x.role} className="btn sm" onClick={() => show(x.stationId)}>{x.role === "eat" ? "🍜" : "📚"} {x.spot?.name} · {x.name}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {spots && (
        <div className="col" style={{ gap: 10 }}>
          <h3>🧭 Explore nearby today</h3>
          {spots.map((x) => <ExploreCard key={x.id} x={x} onGo={() => goTo(x)} />)}
          {!spots.length && <div className="card muted">No spots of that kind nearby. Try another type.</div>}
          <div className="tiny muted">Hours can change on holidays and by season. Check before you go.</div>
        </div>
      )}
    </Sheet>
  );
}
