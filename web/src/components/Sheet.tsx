import type { ReactNode } from "react";
import { useI18n } from "../i18n";

export function Sheet({ title, sub, onClose, children, full, right }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; full?: boolean; right?: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className={`sheet ${full ? "full" : ""}`} role="dialog" aria-label={typeof title === "string" ? title : undefined}>
      {!full && <div className="grab" />}
      <div className="head">
        <div className="grow">
          <h2>{title}</h2>
          {sub && <div className="small muted" style={{ marginTop: 4 }}>{sub}</div>}
        </div>
        {right}
        <button className="icon-btn" onClick={onClose} aria-label={t("close")}>✕</button>
      </div>
      <div className="body">{children}</div>
    </section>
  );
}

export function Stepper({ value, onChange, min, max, step, format }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; format: (v: number) => string }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <button className="icon-btn" aria-label="less" onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <b style={{ minWidth: 54, textAlign: "center", fontSize: 18 }}>{format(value)}</b>
      <button className="icon-btn" aria-label="more" onClick={() => onChange(Math.min(max, value + step))}>+</button>
    </div>
  );
}

export function BarChart({ data, color = "#c6ff3d", height = 120, label }: { data: { x: number | string; y: number }[]; color?: string; height?: number; label?: (y: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.y));
  const w = 320, bw = w / Math.max(1, data.length);
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${height + 18}`} role="img">
      {data.map((d, i) => {
        const h = (d.y / max) * height;
        return (
          <g key={i}>
            <rect x={i * bw + 1.5} y={height - h} width={Math.max(1, bw - 3)} height={h} rx={2} fill={color} opacity={0.9}>
              <title>{`${d.x}: ${label ? label(d.y) : d.y}`}</title>
            </rect>
            {(data.length <= 12 || i % 3 === 0) && (
              <text x={i * bw + bw / 2} y={height + 13} fontSize="9" textAnchor="middle" fill="#b4b8c4">{d.x}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "a" : "p"}`;
