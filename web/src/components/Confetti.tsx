import { useEffect, useRef } from "react";

/** Lightweight canvas confetti burst (no library). */
export function Confetti({ colors = ["#c6ff3d", "#3ddc97", "#5ab0ff", "#ffd166", "#ff5a5f"], count = 160 }: { colors?: string[]; count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext("2d")!;
    const W = (c.width = innerWidth), H = (c.height = innerHeight);
    const parts = Array.from({ length: count }, () => ({
      x: W / 2 + (Math.random() - 0.5) * 80, y: H * 0.32, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 15 - 4,
      r: 4 + Math.random() * 5, a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.4, c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let raf = 0, t = 0;
    const tick = () => {
      g.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.42; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
        g.save(); g.translate(p.x, p.y); g.rotate(p.a); g.fillStyle = p.c; g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); g.restore();
      }
      if (++t < 170) raf = requestAnimationFrame(tick);
      else g.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [colors, count]);
  return <canvas ref={ref} className="confetti" aria-hidden />;
}
