import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, haversine } from "./api";

export interface School { id: string; name: string; short: string; color: string; city: string; homeStations: string[]; emailDomains: string[]; lat: number; lon: number }
export interface Station { id: string; name: string; lat: number; lon: number; routes: string[]; neighborhoodId: string | null; municipality: string }
export interface Route { id: string; name: string; short: string; color: string; stopIds: string[] }
export interface Neighborhood { id: string; name: string; kind: string; blurb: string; icon: string; color: string }
export interface Config {
  demoMode: boolean; devShowMagicLink: boolean; gemini: boolean; geminiModel: string | null; solana: boolean; database: string; timescale: boolean;
  schools: School[]; personas: { key: string; name: string; school: string }[];
}
export interface Statics {
  routes: Route[]; shapes: { type: "FeatureCollection"; features: any[] }; stations: Station[]; schools: School[]; neighborhoods: Neighborhood[];
  cravings: { id: string; label: string }[]; vibes: string[];
}
export interface MapState { collected: string[]; stamps: string[]; weekOwners: Record<string, { school: string; checkins: number }>; lines: { routeId: string; chaos: number; shuttle: boolean; alertCount: number }[] }
export type Mode = "explore" | "study" | "live" | "ride";
export type Panel = null | "plan" | "board" | "me" | "live" | "ride";
export interface Pos { lat: number; lon: number; accuracy: number }

interface Store {
  config: Config | null;
  statics: Statics | null;
  me: any | null;
  mapState: MapState | null;
  pos: Pos | null;
  geoError: string | null;
  mode: Mode;
  setMode: (m: Mode) => void;
  panel: Panel;
  setPanel: (p: Panel) => void;
  stationId: string | null;
  openStation: (id: string | null) => void;
  checkinSpot: any | null;
  setCheckinSpot: (s: any | null) => void;
  focus: { lat: number; lon: number; zoom?: number } | null;
  flyTo: (lat: number, lon: number, zoom?: number) => void;
  refresh: () => Promise<void>;
  toast: (msg: string) => void;
  toastMsg: string | null;
  stationById: Map<string, Station>;
  routeById: Map<string, Route>;
  schoolById: Map<string, School>;
  nbById: Map<string, Neighborhood>;
  signedOutBrowse: boolean;
  setSignedOutBrowse: (b: boolean) => void;
  justCollected: string | null;
  markCollected: (stationId: string) => void;
}

const Ctx = createContext<Store>(null as any);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [statics, setStatics] = useState<Statics | null>(null);
  const [me, setMe] = useState<any | null>(null);
  const [mapState, setMapState] = useState<MapState | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("explore");
  const [panel, setPanel] = useState<Panel>(null);
  const [stationId, setStationId] = useState<string | null>(null);
  const [checkinSpot, setCheckinSpot] = useState<any | null>(null);
  const [focus, setFocus] = useState<Store["focus"]>(null);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [signedOutBrowse, setSignedOutBrowse] = useState(false);
  const [justCollected, setJustCollected] = useState<string | null>(null);
  const toastTimer = useRef<number>(0);

  const refresh = useCallback(async () => {
    const [m, ms] = await Promise.all([api.get("/me").catch(() => null), api.get<MapState>("/map").catch(() => null)]);
    setMe(m);
    if (ms) setMapState(ms);
  }, []);

  useEffect(() => {
    api.get<Config>("/config").then(setConfig).catch(() => {});
    api.get<Statics>("/map/static").then(setStatics).catch(() => {});
    refresh();
    const t = setInterval(() => api.get<MapState>("/map").then(setMapState).catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!("geolocation" in navigator)) return setGeoError("Location isn't available in this browser.");
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy });
        setGeoError(null);
      },
      (e) => setGeoError(e.code === 1 ? "Location permission is off. Turn it on to check in." : "Can't get your location right now."),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const toast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const value = useMemo<Store>(() => {
    const stationById = new Map((statics?.stations ?? []).map((s) => [s.id, s]));
    return {
      config, statics, me, mapState, pos, geoError, mode, setMode, panel, setPanel,
      stationId,
      openStation: (id) => {
        setStationId(id);
        if (id) setPanel(null);
      },
      checkinSpot, setCheckinSpot, focus,
      flyTo: (lat, lon, zoom) => setFocus({ lat, lon, zoom }),
      refresh, toast, toastMsg,
      stationById,
      routeById: new Map((statics?.routes ?? []).map((r) => [r.id, r])),
      schoolById: new Map((statics?.schools ?? config?.schools ?? []).map((s) => [s.id, s])),
      nbById: new Map((statics?.neighborhoods ?? []).map((n) => [n.id, n])),
      signedOutBrowse, setSignedOutBrowse,
      justCollected,
      markCollected: (sid) => {
        setJustCollected(sid);
        setTimeout(() => setJustCollected(null), 4000);
      },
    };
  }, [config, statics, me, mapState, pos, geoError, mode, panel, stationId, checkinSpot, focus, refresh, toast, toastMsg, signedOutBrowse, justCollected]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);

export function nearestStation(stations: Station[], pos: Pos | null) {
  if (!pos || !stations.length) return null;
  let best = stations[0], bd = Infinity;
  for (const s of stations) {
    const d = haversine(pos.lat, pos.lon, s.lat, s.lon);
    if (d < bd) { bd = d; best = s; }
  }
  return { station: best, distanceM: bd };
}

export function LinePill({ id }: { id: string }) {
  const { routeById } = useStore();
  const r = routeById.get(id);
  const label = id.startsWith("Green-") ? id.slice(6) : id === "Mattapan" ? "M" : id[0];
  return (
    <span className="line-pill" style={{ background: r?.color ?? "#555" }} title={r?.name}>
      {id.startsWith("Green-") ? `G${label}` : label}
    </span>
  );
}

export const spotEmoji = (s: any) =>
  s.kind === "landmark" ? "🏛️" : s.kind === "hangout" ? "🌳" : s.kind === "study" ? "📚"
  : s.cuisines?.includes("pizza") ? "🍕" : s.cuisines?.some((c: string) => /ramen|noodle|pho/.test(c)) ? "🍜"
  : s.cuisines?.some((c: string) => /indian|nepal|pakistan|bangla/.test(c)) ? "🍛" : s.cuisines?.some((c: string) => /mexican|burrito|taco/.test(c)) ? "🌯"
  : s.cuisines?.some((c: string) => /chinese|dumpling/.test(c)) ? "🥟" : s.cuisines?.some((c: string) => /japanese|sushi/.test(c)) ? "🍣"
  : s.cuisines?.some((c: string) => /korean/.test(c)) ? "🍲" : s.cuisines?.some((c: string) => /thai|vietnam/.test(c)) ? "🥢"
  : s.cuisines?.some((c: string) => /bakery|donut|dessert|ice_cream/.test(c)) ? "🧁" : s.cuisines?.some((c: string) => /coffee|bubble/.test(c)) ? "☕"
  : s.cuisines?.some((c: string) => /sandwich|bagel|deli/.test(c)) ? "🥪" : s.cuisines?.some((c: string) => /burger|chicken|american/.test(c)) ? "🍔"
  : s.amenity === "cafe" ? "☕" : "🍽️";
