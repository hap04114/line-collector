import { useEffect, useRef, useState } from "react";
import { api, ApiError, fmtDist, haversine } from "../api";
import { useI18n } from "../i18n";
import { spotEmoji, useStore } from "../store";
import { Sheet } from "./Sheet";

/** Downscale on the phone before upload: venue wifi is slow and the server resizes anyway. */
async function shrink(file: File, max = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b || file), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

function CountUp({ to }: { to: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const step = (ts: number) => {
      const k = Math.min(1, (ts - t0) / 900);
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{v}</>;
}

export function CheckinFlow() {
  const s = useStore();
  const { t } = useI18n();
  const spot = s.checkinSpot;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [phase, setPhase] = useState<"capture" | "sending" | "pending" | "done" | "error">("capture");
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const dist = s.pos ? haversine(s.pos.lat, s.pos.lon, spot.lat, spot.lon) : null;
  const radius = spot.checkinRadiusM ?? 150;
  const near = dist != null && dist <= radius;
  const canSubmit = !!file && (near || demo);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const close = () => s.setCheckinSpot(null);

  const finish = (r: any) => {
    setResult(r);
    setPhase("done");
    if (r.newStop) s.markCollected(spot.stationId);
    s.refresh();
  };

  const submit = async () => {
    if (!file) return;
    setPhase("sending");
    setErr(null);
    const fd = new FormData();
    fd.append("spotId", spot.id);
    if (s.pos) {
      fd.append("lat", String(s.pos.lat));
      fd.append("lon", String(s.pos.lon));
    }
    if (demo) fd.append("demoLocation", "true");
    fd.append("photo", await shrink(file), "photo.jpg");
    try {
      const r = await api.form("/checkin", fd);
      if (r.status === "pending") {
        setPhase("pending");
        for (let i = 0; i < 25; i++) {
          await new Promise((res) => setTimeout(res, 2000));
          const c = await api.get(`/checkins/${r.checkinId}`).catch(() => null);
          if (c && c.status !== "pending") {
            if (c.status === "rejected") throw new ApiError(422, c.verify_note || c.verifyNote || "Photo not accepted");
            const me = await api.get("/me").catch(() => null);
            return finish({ ...r, status: "scored", points: c.points, reasons: (c.reasons || []).map((x: any) => (x.mult ? `x${x.mult} ${x.label}` : x.points ? `+${x.points} ${x.label}` : x.label)), newStop: c.is_new_stop, totalPoints: me?.points, level: me?.level?.name });
          }
        }
        s.toast("Photo check is taking a while. Your points will land shortly.");
        return close();
      }
      finish(r);
    } catch (e) {
      setErr((e as Error).message);
      setPhase("error");
    }
  };

  if (phase === "done" && result) {
    return (
      <Sheet title={result.newStop ? `🎉 ${t("newStop")}` : t("nice")} onClose={close} full>
        <div className="points-burst">+<CountUp to={result.points} /></div>
        <div className="center muted">{t("pointsEarned")} at {spot.name}</div>
        <div>
          {result.reasons.map((r: string, i: number) => (
            <div key={i} className="reason" style={{ animationDelay: `${i * 120}ms` }}>
              <span>{r.replace(/^([+x][\d.]+) /, "")}</span>
              <span style={{ color: "var(--accent)" }}>{r.match(/^([+x][\d.]+)/)?.[1] ?? ""}</span>
            </div>
          ))}
        </div>
        {result.badges?.length > 0 && (
          <div className="card hero center">
            <div style={{ fontSize: 44 }}>{result.badges.map((b: any) => b.icon).join(" ")}</div>
            <b>New badge{result.badges.length > 1 ? "s" : ""}: {result.badges.map((b: any) => b.name).join(", ")}</b>
            {s.config?.solana && result.badges.some((b: any) => b.id.startsWith("line-")) && <div className="tiny muted">Recording on Solana devnet…</div>}
          </div>
        )}
        {result.stamp && (
          <div className="banner" style={{ borderColor: "#ffd16666" }}>
            ⭐ Punch card: {Math.min(result.stamp.stamps, result.stamp.needed)}/{result.stamp.needed} for “{result.stamp.offer}”{result.stamp.isSample && ` (${t("sampleOffer")})`}
            {result.stamp.stamps >= result.stamp.needed && <div><b>Ready to redeem in Me → Punch cards!</b></div>}
          </div>
        )}
        {result.streak && <div className="banner ok">🔥 {result.streak.weeks} {t("streak")}{result.streak.usedSkip ? " (your monthly skip covered a missed week)" : ""}</div>}
        <div className="small muted center">
          {result.verified === "verified" ? `✓ Photo verified by Gemini: ${result.verifyNote}` : result.verifyNote}
        </div>
        <button className="btn primary block" onClick={close}>{t("done")}</button>
      </Sheet>
    );
  }

  return (
    <Sheet title={<span>{spotEmoji(spot)} {spot.name}</span>} sub={t("takePhoto")} onClose={close} full>
      <div className={`banner ${near ? "ok" : "warn"}`}>
        {dist == null
          ? s.geoError || "Getting your location…"
          : near
            ? `📍 ${t("youAre")} ${fmtDist(dist)} ${t("away")} ✓`
            : `📍 ${t("youAre")} ${fmtDist(dist)} ${t("away")}. ${t("tooFar")}`}
      </div>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setFile(f);
        setPreview(URL.createObjectURL(f));
      }} />
      {preview ? (
        <>
          <img src={preview} alt="Your check-in" className="photo-preview" />
          <button className="btn ghost" onClick={() => input.current?.click()}>🔄 {t("retake")}</button>
        </>
      ) : (
        <button className="capture" onClick={() => input.current?.click()}>
          <div><div style={{ fontSize: 42 }}>📸</div>{t("takePhoto")}</div>
        </button>
      )}
      {s.config?.demoMode && !near && (
        <label className="check">
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
          <span>{t("demoLocation")}</span>
        </label>
      )}
      <div className="tiny muted">
        Fair play: within {radius} m, a fresh photo{ s.config?.gemini ? " checked by Gemini" : ""}, 5 scored check-ins a day, one per spot per day. Your location is used only for this check-in and never shown to other students.
      </div>
      {phase === "error" && err && <div className="banner danger">{err}</div>}
      <button className="btn primary block" disabled={!canSubmit || phase === "sending" || phase === "pending"} onClick={submit}>
        {phase === "sending" ? t("checkingPhoto") : phase === "pending" ? "Gemini is still checking… points land when it answers" : `✨ ${t("submit")}`}
      </button>
    </Sheet>
  );
}
