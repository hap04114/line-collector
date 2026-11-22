/**
 * Line Runner: an original 3D arcade runner along a real T line (Three.js).
 * Run down the tracks of your line, dodge shuttle buses and delay barriers, grab tokens,
 * and pass the line's real stations in order. Scores have their own board per line;
 * they never touch school-board points, which only come from real check-ins.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { api } from "../api";
import { LinePill, useStore } from "../store";

type Kind = "barrier" | "cone" | "bus" | "token" | "shield";
interface Thing { mesh: THREE.Object3D; lane: number; z: number; kind: Kind; len: number; h: number; alive: boolean }
interface Hud { score: number; tokens: number; distance: number; next: string; stations: number; shield: number; speed: number }

const LANES = [-2.4, 0, 2.4];
const STATION_EVERY = 220;

function labelTexture(text: string, bg: string, fg = "#ffffff", w = 512, h = 128) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(4, 4, w - 8, h - 8, 22);
  g.fill();
  g.fillStyle = fg;
  g.font = `800 ${Math.round(h * 0.42)}px Inter, system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = Math.round(h * 0.42);
  while (g.measureText(text).width > w - 40 && size > 18) {
    size -= 2;
    g.font = `800 ${size}px Inter, system-ui, sans-serif`;
  }
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function windowsTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1a1d27";
  g.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 128; y += 12)
    for (let x = 6; x < 64; x += 14) {
      g.fillStyle = Math.random() < 0.45 ? `hsl(${40 + Math.random() * 20}, 90%, ${55 + Math.random() * 20}%)` : "#262a36";
      g.fillRect(x, y, 8, 7);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function LineRunner({ onClose, initialLine }: { onClose: () => void; initialLine?: string }) {
  const s = useStore();
  const mount = useRef<HTMLDivElement>(null);
  const homeLine = (() => {
    const home = s.config?.schools.find((c) => c.id === s.me?.user?.school?.id)?.homeStations[0];
    return initialLine ?? s.stationById.get(home ?? "")?.routes[0] ?? "Green-B";
  })();
  const [line, setLine] = useState(homeLine);
  const [phase, setPhase] = useState<"ready" | "playing" | "over">("ready");
  const [hud, setHud] = useState<Hud>({ score: 0, tokens: 0, distance: 0, next: "", stations: 0, shield: 0, speed: 0 });
  const [result, setResult] = useState<any>(null);
  const [top, setTop] = useState<any>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const controls = useRef({ left: () => {}, right: () => {}, jump: () => {} });
  const route = s.routeById.get(line);

  useEffect(() => {
    api.get(`/arcade/top?line=${line}`).then(setTop).catch(() => {});
  }, [line, result]);

  useEffect(() => {
    if (phase !== "playing" || !mount.current || !route) return;
    const el = mount.current;
    const lineColor = new THREE.Color(route.color);
    const schoolColor = new THREE.Color(s.me?.user?.school?.color ?? "#c6ff3d");
    const names = route.stopIds.map((id) => s.stationById.get(id)?.name ?? id);
    const home = s.config?.schools.find((c) => c.id === s.me?.user?.school?.id)?.homeStations ?? [];
    let stIdx = Math.max(0, route.stopIds.findIndex((id) => home.includes(id)));
    let dir = stIdx > route.stopIds.length / 2 ? -1 : 1;

    // ---- renderer / scene ------------------------------------------------------------
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0b0d14");
    scene.fog = new THREE.Fog("#0b0d14", 40, 150);
    const camera = new THREE.PerspectiveCamera(62, el.clientWidth / el.clientHeight, 0.1, 400);
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x10121a, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, 14, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
    scene.add(sun, sun.target);
    const glow = new THREE.PointLight(lineColor, 30, 30);
    scene.add(glow);

    // ---- ground, rails ----------------------------------------------------------------
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 400), new THREE.MeshStandardMaterial({ color: 0x1b1e28, roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 0.08, 0.35), new THREE.MeshStandardMaterial({ color: 0x3a3226 }), 3 * 160);
    scene.add(sleepers);
    const railMat = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.9, roughness: 0.3 });
    const rails: THREE.Mesh[] = [];
    for (const x of LANES) for (const off of [-0.7, 0.7]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 400), railMat);
      r.position.set(x + off, 0.07, 0);
      rails.push(r);
      scene.add(r);
    }
    const stripeMat = new THREE.MeshBasicMaterial({ color: lineColor });
    const stripes = [-3.6, 3.6].map((x) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 400), stripeMat);
      m.position.x = x;
      scene.add(m);
      return m;
    });

    // ---- buildings (recycled) -----------------------------------------------------------
    const winTex = windowsTexture();
    const buildings: THREE.Mesh[] = [];
    for (let i = 0; i < 40; i++) {
      const w = 4 + Math.random() * 5, h = 6 + Math.random() * 22, d = 6 + Math.random() * 8;
      const tex = winTex.clone();
      tex.repeat.set(Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(h / 6)));
      tex.needsUpdate = true;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.8 }));
      const side = i % 2 ? 1 : -1;
      b.position.set(side * (9 + w / 2 + Math.random() * 3), h / 2, -i * 9);
      scene.add(b);
      buildings.push(b);
    }

    // ---- player: an original "rider" in your school color --------------------------------
    const player = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.8, 6, 12), new THREE.MeshStandardMaterial({ color: schoolColor, roughness: 0.4 }));
    body.position.y = 0.95;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 18, 14), new THREE.MeshStandardMaterial({ color: 0xf2c9a0 }));
    head.position.y = 1.85;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: lineColor }));
    cap.position.y = 1.9;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.32), new THREE.MeshStandardMaterial({ color: 0x2b2e38 }));
    pack.position.set(0, 1.05, 0.42);
    const shieldBubble = new THREE.Mesh(new THREE.SphereGeometry(1.3, 24, 16), new THREE.MeshBasicMaterial({ color: 0x7ad7ff, transparent: true, opacity: 0.22 }));
    shieldBubble.position.y = 1.1;
    shieldBubble.visible = false;
    for (const m of [body, head, cap, pack]) m.castShadow = true;
    player.add(body, head, cap, pack, shieldBubble);
    scene.add(player);

    // ---- spawnable things ----------------------------------------------------------------
    const things: Thing[] = [];
    const geo = {
      barrier: new THREE.BoxGeometry(2, 0.9, 0.35),
      cone: new THREE.ConeGeometry(0.45, 1.0, 14),
      bus: new THREE.BoxGeometry(2.1, 2.8, 8),
      token: new THREE.CylinderGeometry(0.42, 0.42, 0.1, 24),
      shield: new THREE.SphereGeometry(0.45, 16, 12),
    };
    geo.token.rotateX(Math.PI / 2);
    const delayTex = labelTexture("DELAY", "#ff5a5f", "#fff", 256, 96);
    const mats = {
      barrier: new THREE.MeshStandardMaterial({ map: delayTex, emissive: 0x551010 }),
      cone: new THREE.MeshStandardMaterial({ color: 0xff7a00, emissive: 0x331500 }),
      bus: new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0x2a2000, roughness: 0.5 }),
      token: new THREE.MeshStandardMaterial({ color: 0xffc83d, emissive: 0x6a4a00, metalness: 0.9, roughness: 0.2 }),
      shield: new THREE.MeshStandardMaterial({ color: 0x7ad7ff, emissive: 0x1a5070 }),
    };
    const busSign = labelTexture("SHUTTLE BUS", "#1b1d24", "#ffd23f", 512, 96);
    const spawn = (kind: Kind, lane: number, z: number, y = 0) => {
      const m = new THREE.Mesh(geo[kind], mats[kind]);
      m.castShadow = true;
      const h = kind === "barrier" ? 0.9 : kind === "cone" ? 1.0 : kind === "bus" ? 2.8 : 0;
      m.position.set(LANES[lane], kind === "token" || kind === "shield" ? 1 + y : h / 2, z);
      if (kind === "bus") {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.36), new THREE.MeshBasicMaterial({ map: busSign }));
        sign.position.set(0, 1.0, 4.01);
        m.add(sign);
      }
      scene.add(m);
      things.push({ mesh: m, lane, z, kind, len: kind === "bus" ? 8 : 0.6, h, alive: true });
    };

    // stations: platforms + name signs, every STATION_EVERY meters
    const stationGroups: { g: THREE.Group; z: number; name: string; counted: boolean }[] = [];
    const platformMat = new THREE.MeshStandardMaterial({ color: 0x5b6070 });
    const addStation = (z: number, name: string) => {
      const g = new THREE.Group();
      for (const side of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 30), platformMat);
        p.position.set(side * 5.6, 0.45, 0);
        p.receiveShadow = true;
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.92, 30), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
        edge.position.set(side * 4.35, 0.46, 0);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), new THREE.MeshBasicMaterial({ map: labelTexture(name, route.color), side: THREE.DoubleSide }));
        sign.position.set(side * 5.6, 3.4, 4);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), platformMat);
        post.position.set(side * 5.6, 2.0, 4);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(3, 0.15, 26), new THREE.MeshStandardMaterial({ color: lineColor, emissive: lineColor, emissiveIntensity: 0.25 }));
        roof.position.set(side * 5.8, 4.4, 0);
        g.add(p, edge, sign, post, roof);
      }
      g.position.z = z;
      scene.add(g);
      stationGroups.push({ g, z, name, counted: false });
    };
    const nextName = () => {
      if (stIdx + dir < 0 || stIdx + dir >= names.length) dir = -dir;
      stIdx += dir;
      return names[stIdx];
    };
    let nextStationZ = -60;
    addStation(nextStationZ, nextName());

    // ---- state ------------------------------------------------------------------------------
    const st = { lane: 1, x: 0, y: 0, vy: 0, z: 0, speed: 14, dist: 0, tokens: 0, stations: 0, shield: 0, over: false, nextSpawn: -40, t0: performance.now() };
    controls.current = {
      left: () => { if (st.lane > 0) st.lane--; },
      right: () => { if (st.lane < 2) st.lane++; },
      jump: () => { if (st.y <= 0.001) st.vy = 9.5; },
    };
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowLeft", "a", "A"].includes(e.key)) controls.current.left();
      else if (["ArrowRight", "d", "D"].includes(e.key)) controls.current.right();
      else if (["ArrowUp", "w", "W", " "].includes(e.key)) controls.current.jump();
      else return;
      e.preventDefault();
    };
    let touch: { x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => { touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
    const onTouchEnd = (e: TouchEvent) => {
      if (!touch) return;
      const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 25) (dx < 0 ? controls.current.left : controls.current.right)();
      else if (dy < -25 || Math.abs(dy) < 12) controls.current.jump();
      touch = null;
    };
    window.addEventListener("keydown", onKey);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    const onResize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    // spawn a row of hazards/tokens, always leaving a free lane
    const spawnRow = (z: number) => {
      const free = Math.floor(Math.random() * 3);
      const pattern = Math.random();
      for (let lane = 0; lane < 3; lane++) {
        if (lane === free) continue;
        const r = Math.random();
        if (r < 0.28) spawn("bus", lane, z - 4);
        else if (r < 0.55) spawn("barrier", lane, z);
        else if (r < 0.7) spawn("cone", lane, z);
      }
      if (pattern < 0.75) for (let i = 0; i < 5; i++) spawn("token", free, z + 6 - i * 2.4);
      else if (pattern < 0.82 && st.dist > 300) spawn("shield", free, z);
    };

    // ---- loop -----------------------------------------------------------------------------
    let raf = 0, last = performance.now(), hudT = 0;
    const tmp = new THREE.Object3D();
    const end = () => {
      st.over = true;
      const durationMs = Math.round(performance.now() - st.t0);
      setPhase("over");
      api
        .post("/arcade/score", { routeId: line, distance: Math.round(st.dist), tokens: st.tokens, stations: st.stations, durationMs: Math.max(1000, durationMs) })
        .then(setResult)
        .catch(() => setResult({ score: Math.round(st.dist) + st.tokens * 10 + st.stations * 50, offline: true }));
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (st.over) return renderer.render(scene, camera);

      st.speed = Math.min(40, st.speed + dt * 0.28);
      st.z -= st.speed * dt;
      st.dist += st.speed * dt;
      st.x += (LANES[st.lane] - st.x) * Math.min(1, dt * 14);
      st.vy -= 26 * dt;
      st.y = Math.max(0, st.y + st.vy * dt);
      if (st.y === 0) st.vy = Math.max(0, st.vy);
      st.shield = Math.max(0, st.shield - dt);

      player.position.set(st.x, st.y, st.z);
      const stride = Math.sin(st.dist * 1.4);
      body.rotation.z = (LANES[st.lane] - st.x) * -0.15;
      body.position.y = 0.95 + (st.y > 0 ? 0 : Math.abs(stride) * 0.12);
      shieldBubble.visible = st.shield > 0;

      camera.position.set(st.x * 0.6, 4.4 + st.y * 0.3, st.z + 7.5);
      camera.lookAt(st.x * 0.8, 1.4, st.z - 8);
      sun.position.set(st.x + 6, 14, st.z + 4);
      sun.target.position.set(st.x, 0, st.z - 4);
      glow.position.set(0, 5, st.z - 10);
      ground.position.z = st.z - 150;
      for (const r of rails) r.position.z = st.z - 150;
      for (const m of stripes) m.position.z = st.z - 150;
      const base = Math.floor(st.z / 1.2) * 1.2;
      for (let i = 0; i < 160; i++)
        for (let l = 0; l < 3; l++) {
          tmp.position.set(LANES[l], 0.04, base - i * 1.2 + 10);
          tmp.updateMatrix();
          sleepers.setMatrixAt(i * 3 + l, tmp.matrix);
        }
      sleepers.instanceMatrix.needsUpdate = true;
      for (const b of buildings) if (b.position.z > st.z + 15) b.position.z -= 40 * 9;

      // spawning ahead
      while (st.nextSpawn > st.z - 130) {
        if (Math.abs(st.nextSpawn - nextStationZ) > 22) spawnRow(st.nextSpawn);
        st.nextSpawn -= 16 + Math.random() * 10 - Math.min(6, st.speed / 8);
      }
      if (nextStationZ > st.z - 160) {
        nextStationZ -= STATION_EVERY;
        addStation(nextStationZ, nextName());
      }

      // stations passed
      for (const sg of stationGroups) {
        if (!sg.counted && st.z < sg.z) {
          sg.counted = true;
          st.stations++;
          setFlash(`🚉 ${sg.name} +50`);
          setTimeout(() => setFlash(null), 1300);
        }
      }

      // collisions
      for (const t of things) {
        if (!t.alive) continue;
        if (t.kind === "token") t.mesh.rotation.y += dt * 4;
        const dz = Math.abs(t.z - st.z);
        if (t.lane !== st.lane || Math.abs(st.x - LANES[t.lane]) > 1.1) continue;
        if (t.kind === "token" && dz < 1.0 && st.y < 2.2) {
          t.alive = false;
          scene.remove(t.mesh);
          st.tokens++;
        } else if (t.kind === "shield" && dz < 1.0) {
          t.alive = false;
          scene.remove(t.mesh);
          st.shield = 6;
          setFlash("☕ Coffee shield: 6 s");
          setTimeout(() => setFlash(null), 1300);
        } else if ((t.kind === "barrier" || t.kind === "cone" || t.kind === "bus") && dz < t.len / 2 + 0.45) {
          const cleared = t.kind !== "bus" && st.y > t.h - 0.1;
          if (cleared) continue;
          if (st.shield > 0) {
            t.alive = false;
            scene.remove(t.mesh);
            st.shield = 0;
            setFlash("Shield used!");
            setTimeout(() => setFlash(null), 900);
          } else {
            return end();
          }
        }
      }
      // cleanup behind
      for (let i = things.length - 1; i >= 0; i--)
        if (things[i].z > st.z + 12) {
          scene.remove(things[i].mesh);
          things.splice(i, 1);
        }
      for (let i = stationGroups.length - 1; i >= 0; i--)
        if (stationGroups[i].z > st.z + 40) {
          scene.remove(stationGroups[i].g);
          stationGroups.splice(i, 1);
        }

      hudT += dt;
      if (hudT > 0.1) {
        hudT = 0;
        const upcoming = stationGroups.find((g) => !g.counted);
        setHud({
          score: Math.round(st.dist) + st.tokens * 10 + st.stations * 50, tokens: st.tokens, distance: Math.round(st.dist),
          next: upcoming?.name ?? "", stations: st.stations, shield: Math.ceil(st.shield), speed: Math.round(st.speed * 3.6),
        });
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      renderer.dispose();
      scene.traverse((o: any) => {
        o.geometry?.dispose?.();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => { m.map?.dispose?.(); m.dispose?.(); });
      });
      el.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, line]);

  const start = () => {
    setResult(null);
    setHud({ score: 0, tokens: 0, distance: 0, next: "", stations: 0, shield: 0, speed: 0 });
    setPhase("playing");
  };

  return (
    <div className="runner">
      <div ref={mount} className="runner-stage" />
      <div className="runner-top">
        <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        <div className="runner-hud">
          <div><b>{hud.score.toLocaleString()}</b><span>score</span></div>
          <div><b>🪙 {hud.tokens}</b><span>tokens</span></div>
          <div><b>{hud.distance} m</b><span>{hud.speed} km/h</span></div>
          {hud.shield > 0 && <div><b>☕ {hud.shield}s</b><span>shield</span></div>}
        </div>
      </div>
      {phase === "playing" && hud.next && <div className="runner-next">Next: <b>{hud.next}</b></div>}
      {flash && <div className="runner-flash">{flash}</div>}
      {phase === "playing" && (
        <div className="runner-pad">
          <button onClick={() => controls.current.left()} aria-label="Left">◀</button>
          <button onClick={() => controls.current.jump()} aria-label="Jump">▲</button>
          <button onClick={() => controls.current.right()} aria-label="Right">▶</button>
        </div>
      )}
      {phase !== "playing" && (
        <div className="runner-card">
          {phase === "ready" ? (
            <>
              <div className="logo" style={{ fontSize: 28 }}>Line <i>Runner</i></div>
              <p className="small muted" style={{ margin: 0 }}>
                Run your T line. Dodge shuttle buses, jump DELAY barriers and cones, grab tokens, and pass the line's real stations (+50 each).
                ← → / A D to switch lanes, ↑ / W / Space to jump, or swipe.
              </p>
            </>
          ) : (
            <>
              <div className="points-burst" style={{ fontSize: 52 }}>{(result?.score ?? hud.score).toLocaleString()}</div>
              <div className="center">
                {result?.newBest && <span className="tag ok">🏆 New personal best!</span>}{" "}
                {result?.rank && <span className="tag">#{result.rank} on the {route?.short} board</span>}
              </div>
              <div className="center small muted">{hud.distance} m · {hud.tokens} tokens · {hud.stations} stations</div>
            </>
          )}
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {(s.statics?.routes ?? []).map((r) => (
              <button key={r.id} className={`chip ${line === r.id ? "on" : ""}`} onClick={() => setLine(r.id)}><LinePill id={r.id} /> {r.short}</button>
            ))}
          </div>
          <button className="btn primary block" onClick={start}>{phase === "ready" ? "▶ Start run" : "↻ Run again"}</button>
          {top && (top.players.length > 0 || top.schools.length > 0) && (
            <div className="col" style={{ gap: 6 }}>
              <b className="small">{route?.short} board</b>
              {top.schools.length > 0 && (
                <div className="row wrap">{top.schools.map((x: any) => <span key={x.school} className="tag" style={{ borderColor: x.color }}>{x.school} {x.best}</span>)}</div>
              )}
              {top.players.slice(0, 5).map((p: any, i: number) => (
                <div key={i} className="row between small"><span>{i + 1}. {p.name}{p.me ? " (you)" : ""} · {p.school}</span><b>{p.score}</b></div>
              ))}
            </div>
          )}
          <div className="tiny muted">Arcade scores have their own board. School points only come from real check-ins.</div>
        </div>
      )}
    </div>
  );
}
