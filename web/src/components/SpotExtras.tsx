import { useEffect, useRef, useState } from "react";
import { api, money } from "../api";
import { useStore } from "../store";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hl = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "a" : "p"}`;

/** Best time to go: 7×24 visits heatmap from the Tiger Data spot_visits_hourly aggregate. */
export function BusyHeat({ spotId }: { spotId: string }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get(`/spots/${spotId}/busy`).then(setD).catch(() => {}); }, [spotId]);
  if (!d) return null;
  if (!d.total) return <div className="tiny muted">⏱️ Best time to go: not enough check-ins here yet. Yours will start the chart.</div>;
  const grid = new Map(d.cells.map((c: any) => [`${c.dow}-${c.hour}`, c.visits]));
  const max = Math.max(1, ...d.cells.map((c: any) => c.visits));
  const hours = Array.from({ length: 16 }, (_, i) => i + 7); // 7 AM – 10 PM
  return (
    <div className="col" style={{ gap: 4 }}>
      <b className="small">⏱️ Best time to go</b>
      <div style={{ display: "grid", gridTemplateColumns: `28px repeat(${hours.length}, 1fr)`, gap: 2 }}>
        <span />
        {hours.map((h) => <span key={h} className="tiny muted" style={{ fontSize: 8, textAlign: "center" }}>{h % 3 === 1 ? hl(h) : ""}</span>)}
        {DAYS.map((day, dow) => (
          <div key={day} style={{ display: "contents" }}>
            <span className="tiny muted" style={{ fontSize: 9 }}>{day}</span>
            {hours.map((h) => {
              const v = (grid.get(`${dow}-${h}`) as number) ?? 0;
              return <span key={h} title={`${day} ${hl(h)}: ${v} visits`} style={{ height: 10, borderRadius: 2, background: v ? `rgba(198,255,61,${0.2 + 0.8 * (v / max)})` : "#262a36" }} />;
            })}
          </div>
        ))}
      </div>
      <div className="tiny muted">{d.busiest ? `Busiest: ${DAYS[d.busiest.dow]} ${hl(d.busiest.hour)}. ` : ""}{d.total} student check-ins · {d.source}</div>
    </div>
  );
}

/** Snap the menu → Gemini reads items and prices → the spot gets a real price. */
export function MenuReader({ spotId, onUpdated }: { spotId: string; onUpdated: () => void }) {
  const s = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.get(`/spots/${spotId}/menu`).then((r) => r.items.length && setItems(r.items.map((x: any) => ({ name: x.name, price: x.price_cents / 100 })))).catch(() => {}); }, [spotId]);
  const send = async (f: File) => {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("photo", f);
      const r = await api.form(`/spots/${spotId}/menu`, fd);
      setItems(r.items);
      s.toast(`Read ${r.items.length} prices. Cheapest: ${r.cheapest.name} ${money(Math.round(r.cheapest.price * 100))}`);
      onUpdated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="col" style={{ gap: 6 }}>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
      <button className="btn sm" disabled={busy || !s.me} onClick={() => input.current?.click()}>{busy ? "Gemini is reading the menu…" : "📷 Add menu prices (Gemini reads it)"}</button>
      {err && <div className="tiny error">{err}</div>}
      {items && (
        <div className="card tight">
          <b className="small">Menu from students</b>
          {items.slice(0, 8).map((x, i) => <div key={i} className="row between small"><span>{x.name}</span><span>{money(Math.round(x.price * 100))}</span></div>)}
          {items.length > 8 && <div className="tiny muted">+{items.length - 8} more</div>}
        </div>
      )}
    </div>
  );
}
