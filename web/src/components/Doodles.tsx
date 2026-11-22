/** Hand-drawn Boston doodles (original line art), in the BostonHacks palette. */
import type { CSSProperties, ReactElement } from "react";

const S = { fill: "none", stroke: "#0b1220", strokeWidth: 2.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export type DoodleName = "swan" | "ducks" | "bridge" | "trolley" | "brownstones" | "lobster" | "dome" | "rower" | "sailboat" | "coffee" | "snow" | "star";

const ART: Record<DoodleName, ReactElement> = {
  swan: (
    <g>
      <path {...S} d="M8 46 C14 56 46 56 56 46 Z" fill="#cfe2ff" />
      <path {...S} d="M22 46 C18 36 24 30 30 33 C34 35 34 41 40 40 C46 39 48 30 44 22 C42 17 36 16 34 20" />
      <path {...S} d="M34 20 L28 21" stroke="#F7A600" />
      <path {...S} d="M14 46 L14 38 M50 46 L50 40" />
    </g>
  ),
  ducks: (
    <g>
      {[0, 18, 33].map((x, i) => (
        <g key={x} transform={`translate(${x} ${i * 3}) scale(${1 - i * 0.18})`}>
          <path {...S} d="M6 40 C6 30 22 30 24 36 C28 34 30 30 28 26 C26 22 20 22 19 27" fill="#ffe36b" />
          <path {...S} d="M19 27 L14 28" stroke="#F7A600" />
          <circle cx="23" cy="26" r="1.2" fill="#0b1220" />
        </g>
      ))}
      <path {...S} d="M4 48 C14 46 26 50 36 47 C46 44 54 48 60 47" stroke="#206DDF" />
    </g>
  ),
  bridge: (
    <g>
      <path {...S} d="M2 44 L62 44" />
      <path {...S} d="M20 44 L22 10 L24 44 M42 44 L44 10 L46 44" />
      {[0, 6, 12, 18].map((d) => <path key={d} {...S} strokeWidth={1.6} d={`M22 ${14 + d / 2} L${4 + d} 44 M22 ${14 + d / 2} L${40 - d} 44 M44 ${14 + d / 2} L${26 + d} 44 M44 ${14 + d / 2} L${62 - d} 44`} stroke="#206DDF" />)}
      <path {...S} d="M2 54 C12 52 20 56 32 53 C44 50 52 55 62 53" stroke="#206DDF" />
    </g>
  ),
  trolley: (
    <g>
      <rect {...S} x="6" y="20" width="52" height="26" rx="6" fill="#d7f1df" />
      <path {...S} d="M6 30 L58 30" />
      {[12, 24, 36, 48].map((x) => <rect key={x} {...S} strokeWidth={2} x={x} y="23" width="7" height="5" rx="1" fill="#fff" />)}
      <circle {...S} cx="16" cy="50" r="4" fill="#fff" /><circle {...S} cx="48" cy="50" r="4" fill="#fff" />
      <path {...S} d="M32 20 L32 10 L22 4 M32 10 L42 4" />
      <path {...S} d="M2 56 L62 56" />
    </g>
  ),
  brownstones: (
    <g>
      {[4, 24, 44].map((x, i) => (
        <g key={x}>
          <path {...S} d={`M${x} 58 L${x} ${18 + i * 4} L${x + 16} ${18 + i * 4} L${x + 16} 58`} fill={["#f3c7a6", "#e9b08d", "#f3c7a6"][i]} />
          <path {...S} d={`M${x - 1} ${18 + i * 4} L${x + 17} ${18 + i * 4}`} strokeWidth={3.4} />
          {[0, 12].map((y) => <rect key={y} {...S} strokeWidth={1.8} x={x + 4} y={24 + i * 4 + y} width="8" height="7" rx="1" fill="#fff" />)}
          <path {...S} strokeWidth={1.8} d={`M${x + 5} 58 L${x + 5} 50 L${x + 11} 50 L${x + 11} 58`} />
        </g>
      ))}
    </g>
  ),
  lobster: (
    <g>
      <ellipse {...S} cx="32" cy="34" rx="8" ry="14" fill="#ff8a7a" />
      <path {...S} d="M26 26 C18 22 14 14 18 8 C22 12 22 16 26 20 M38 26 C46 22 50 14 46 8 C42 12 42 16 38 20" fill="#ff8a7a" />
      <path {...S} d="M24 34 L16 36 M24 40 L17 44 M40 34 L48 36 M40 40 L47 44" />
      <path {...S} d="M28 48 L32 56 L36 48" fill="#ff8a7a" />
      <path {...S} strokeWidth={1.6} d="M29 20 C26 12 24 8 20 6 M35 20 C38 12 40 8 44 6" />
    </g>
  ),
  dome: (
    <g>
      <path {...S} d="M14 34 C14 18 50 18 50 34 Z" fill="#F7DD04" />
      <path {...S} d="M32 22 L32 12 M28 12 L36 12 M32 12 L32 8" />
      <rect {...S} x="10" y="34" width="44" height="22" fill="#fff" />
      {[16, 26, 36, 46].map((x) => <path key={x} {...S} strokeWidth={2} d={`M${x} 38 L${x} 56`} />)}
      <path {...S} d="M6 58 L58 58" />
    </g>
  ),
  rower: (
    <g>
      <path {...S} d="M4 42 C20 46 44 46 60 42 L56 46 C40 50 22 50 8 46 Z" fill="#cfe2ff" />
      {[18, 32, 46].map((x) => (
        <g key={x}>
          <circle {...S} cx={x} cy="30" r="3" fill="#fff" />
          <path {...S} d={`M${x} 33 L${x} 41 M${x - 6} 36 L${x + 8} 50`} />
        </g>
      ))}
      <path {...S} d="M2 54 C14 52 22 56 34 53 C46 50 54 55 62 53" stroke="#206DDF" />
    </g>
  ),
  sailboat: (
    <g>
      <path {...S} d="M30 8 L30 46 M30 10 L50 42 L30 42 M30 16 L14 42 L30 42" fill="#fff" />
      <path {...S} d="M10 46 L54 46 L48 54 L16 54 Z" fill="#ff8a7a" />
      <path {...S} d="M2 58 C14 56 22 60 34 57 C46 54 54 59 62 57" stroke="#206DDF" />
    </g>
  ),
  coffee: (
    <g>
      <path {...S} d="M14 24 L50 24 L46 56 L18 56 Z" fill="#fff" />
      <path {...S} d="M12 24 L52 24 L50 18 L14 18 Z" fill="#F7DD04" />
      <path {...S} d="M18 36 L46 36" stroke="#DA291C" strokeWidth={4} />
      <path {...S} strokeWidth={2} d="M26 12 C24 8 28 6 26 2 M34 12 C32 8 36 6 34 2" />
    </g>
  ),
  snow: (
    <g>
      {[0, 60, 120].map((r) => <path key={r} {...S} d="M32 8 L32 56 M26 14 L32 20 L38 14 M26 50 L32 44 L38 50" transform={`rotate(${r} 32 32)`} stroke="#206DDF" />)}
    </g>
  ),
  star: <path {...S} d="M32 6 L38 24 L58 24 L42 36 L48 56 L32 44 L16 56 L22 36 L6 24 L26 24 Z" fill="#F7DD04" />,
};

export function Doodle({ name, size = 72, className = "", style }: { name: DoodleName; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`doodle ${className}`} style={style} aria-hidden>
      {ART[name]}
    </svg>
  );
}
