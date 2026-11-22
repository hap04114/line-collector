/**
 * Live → Find a place. Real listings only where an API allows it (RentCast rentals, Google Places hostels/hotels,
 * our verified student sublets); everywhere else, a pre-filled search on the site itself plus a scam check.
 */
import { useEffect, useState } from "react";
import { api, fmtDist, money, qs } from "../api";
import { useStore } from "../store";

type Kind = "apartment" | "room" | "dorm" | "hostel" | "hotel" | "short";
const KINDS: { id: Kind; label: string; monthly: boolean }[] = [
  { id: "apartment", label: "🏢 Apartment", monthly: true },
  { id: "room", label: "🛏️ Room / sublet", monthly: true },
  { id: "dorm", label: "🎓 Dorm / student housing", monthly: true },
  { id: "hostel", label: "🎒 Hostel", monthly: false },
  { id: "hotel", label: "🏨 Hotel", monthly: false },
  { id: "short", label: "🏠 Short stay (Airbnb)", monthly: false },
];

interface Area { id: string; label: string; city: string; lat: number; lon: number }
const AREAS: Area[] = [
  { id: "allston", label: "Allston", city: "Boston", lat: 42.3539, lon: -71.1337 },
  { id: "brighton", label: "Brighton", city: "Boston", lat: 42.3496, lon: -71.1563 },
  { id: "fenway", label: "Fenway / Kenmore", city: "Boston", lat: 42.3467, lon: -71.0972 },
  { id: "mission-hill", label: "Mission Hill", city: "Boston", lat: 42.33, lon: -71.106 },
  { id: "back-bay", label: "Back Bay", city: "Boston", lat: 42.3503, lon: -71.081 },
  { id: "south-end", label: "South End", city: "Boston", lat: 42.3388, lon: -71.0765 },
  { id: "jamaica-plain", label: "Jamaica Plain", city: "Boston", lat: 42.3097, lon: -71.1151 },
  { id: "dorchester", label: "Dorchester", city: "Boston", lat: 42.3016, lon: -71.0676 },
  { id: "east-boston", label: "East Boston", city: "Boston", lat: 42.3702, lon: -71.0389 },
  { id: "cambridge", label: "Cambridge", city: "Cambridge", lat: 42.3736, lon: -71.1097 },
  { id: "somerville", label: "Somerville", city: "Somerville", lat: 42.3876, lon: -71.0995 },
  { id: "brookline", label: "Brookline", city: "Brookline", lat: 42.3318, lon: -71.1212 },
  { id: "medford", label: "Medford", city: "Medford", lat: 42.4184, lon: -71.1062 },
];

const slug = (city: string) => `${city.toLowerCase()}-ma`;
const enc = encodeURIComponent;

/** Pre-filled searches on each site. Checked in a browser: Craigslist, Facebook, Zumper, Airbnb, Google Maps/Hotels honor
 *  these filters; Zillow and Apartments.com block automated checks, so they get their plain city pages. */
export function searchLinks(kind: Kind, area: Area, budget: number, beds: number | null, school?: string) {
  const near = `${area.label}, ${area.city} MA`;
  const cl = (cat: string) => `https://boston.craigslist.org/search/${cat}?max_price=${budget}${beds ? `&min_bedrooms=${beds}` : ""}`;
  const maps = (what: string) => `https://www.google.com/maps/search/${enc(`${what} near ${near}`)}`;
  switch (kind) {
    case "apartment": return [
      { label: "Zillow", href: `https://www.zillow.com/${slug(area.city)}/rentals/` },
      { label: "Apartments.com", href: `https://www.apartments.com/${slug(area.city)}/` },
      { label: "Craigslist", href: cl("apa") },
      { label: "Facebook Marketplace", href: `https://www.facebook.com/marketplace/boston/propertyrentals?maxPrice=${budget}` },
      { label: "Zumper", href: `https://www.zumper.com/apartments-for-rent/${slug(area.city)}?price-max=${budget}` },
    ];
    case "room": return [
      { label: "Craigslist rooms", href: cl("roo") },
      { label: "Facebook Marketplace", href: `https://www.facebook.com/marketplace/boston/propertyrentals?maxPrice=${budget}` },
      { label: "Zumper rooms", href: `https://www.zumper.com/rooms-for-rent/${slug(area.city)}?price-max=${budget}` },
    ];
    case "dorm": return [
      ...(school ? [{ label: `${school} housing office`, href: `https://www.google.com/search?q=${enc(`${school} off-campus housing office`)}` }] : []),
      { label: "Student housing on Google Maps", href: maps("student housing") },
      { label: "Summer & intern housing", href: `https://www.google.com/search?q=${enc(`Boston summer intern student housing ${area.label}`)}` },
    ];
    case "hostel": return [
      { label: "Hostels on Google Maps", href: maps("hostels") },
      { label: "Booking.com", href: `https://www.booking.com/searchresults.html?ss=${enc(`${area.city}, Massachusetts`)}` },
    ];
    case "hotel": return [
      { label: "Google Hotels", href: `https://www.google.com/travel/hotels/${enc(area.city)}` },
      { label: "Hotels on Google Maps", href: maps("cheap hotels") },
      { label: "Booking.com", href: `https://www.booking.com/searchresults.html?ss=${enc(`${area.city}, Massachusetts`)}` },
    ];
    case "short": return [
      { label: "Airbnb", href: `https://www.airbnb.com/s/${enc(area.city)}--MA/homes?price_max=${budget}` },
      { label: "Booking.com", href: `https://www.booking.com/searchresults.html?ss=${enc(`${area.city}, Massachusetts`)}` },
    ];
  }
}

function LineTags({ st }: { st: any }) {
  if (!st) return null;
  return <> · T: {st.name} {st.lines.slice(0, 2).map((l: any) => <span key={l.id} className="fb-line" style={{ background: l.color }}>{l.short.replace("Green ", "")}</span>)} · {st.walkMin} min walk</>;
}

export function HousingFinder({ onCheckListing, onSublets }: { onCheckListing: () => void; onSublets: () => void }) {
  const s = useStore();
  const [kind, setKind] = useState<Kind>("apartment");
  const school = s.config?.schools.find((c) => c.id === s.me?.user?.school?.id);
  const campus: Area | null = school ? { id: "campus", label: `Near ${school.short}`, city: school.city || "Boston", lat: school.lat, lon: school.lon } : null;
  const areas = campus ? [campus, ...AREAS] : AREAS;
  const [areaId, setAreaId] = useState(areas[0].id);
  const area = areas.find((a) => a.id === areaId) ?? areas[0];
  const monthly = KINDS.find((k) => k.id === kind)!.monthly;
  const [rent, setRent] = useState(1600);
  const [night, setNight] = useState(120);
  const [beds, setBeds] = useState<number | null>(null);
  const budget = monthly ? rent : night;
  const [meta, setMeta] = useState<{ rentcast: boolean; google: boolean } | null>(null);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.get("/housing/meta").then(setMeta).catch(() => setMeta({ rentcast: false, google: false })); }, []);
  useEffect(() => {
    setData(null);
    setErr(null);
    if (!meta) return;
    const at = { lat: area.lat.toFixed(4), lon: area.lon.toFixed(4) };
    if (kind === "apartment" && meta.rentcast) api.get(`/housing/rentals?${qs({ ...at, maxRent: rent, beds: beds ?? undefined })}`).then(setData).catch((e) => setErr(e.message));
    if ((kind === "hostel" || kind === "hotel") && meta.google) api.get(`/housing/stays?${qs({ ...at, type: kind })}`).then(setData).catch((e) => setErr(e.message));
  }, [kind, area.id, rent, beds, meta]);

  const links = searchLinks(kind, area, budget, beds, school?.name);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="chips" style={{ flexWrap: "wrap" }}>
        {KINDS.map((k) => <button key={k.id} className={`chip ${kind === k.id ? "on" : ""}`} onClick={() => setKind(k.id)}>{k.label}</button>)}
      </div>
      <div className="field">
        <label htmlFor="hf-area">Where</label>
        <select id="hf-area" className="input" value={area.id} onChange={(e) => setAreaId(e.target.value)}>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </div>
      <div className="field">
        <div className="row between">
          <label htmlFor="hf-budget">{monthly ? "Max rent per month" : "Max per night"}</label>
          <b style={{ color: "var(--accent)" }}>${budget.toLocaleString()}{monthly ? "/mo" : "/night"}</b>
        </div>
        {monthly
          ? <input id="hf-budget" type="range" min={500} max={4500} step={50} value={rent} onChange={(e) => setRent(+e.target.value)} style={{ width: "100%", accentColor: "var(--accent)" }} />
          : <input id="hf-budget" type="range" min={25} max={350} step={5} value={night} onChange={(e) => setNight(+e.target.value)} style={{ width: "100%", accentColor: "var(--accent)" }} />}
      </div>
      {(kind === "apartment") && (
        <div className="seg">
          {[null, 0, 1, 2, 3].map((b) => <button key={String(b)} className={beds === b ? "on" : ""} onClick={() => setBeds(b)}>{b === null ? "Any" : b === 0 ? "Studio" : `${b} bed`}</button>)}
        </div>
      )}

      {/* real listings from APIs that allow it */}
      {kind === "apartment" && meta && !meta.rentcast && <div className="tiny muted">Real listings with prices appear here once the server has a RentCast key. Until then, use the searches below.</div>}
      {(kind === "hostel" || kind === "hotel") && meta && !meta.google && <div className="tiny muted">Nearby {kind}s with ratings appear here once the server has a Google key.</div>}
      {err && <div className="tiny muted">{err}</div>}
      {data?.listings && (
        <div className="col" style={{ gap: 8 }}>
          <b className="small">{data.total} listing{data.total === 1 ? "" : "s"} under ${rent.toLocaleString()}/mo near {area.label}</b>
          {data.listings.map((l: any) => (
            <div key={l.id} className="card tight col" style={{ gap: 4 }}>
              <div className="row between"><b className="small">{l.address}</b><b style={{ color: "var(--accent)" }}>{money(l.priceCents)}/mo</b></div>
              <div className="tiny muted">
                {l.bedrooms === 0 ? "Studio" : l.bedrooms != null ? `${l.bedrooms} bed` : ""}{l.bathrooms ? ` · ${l.bathrooms} bath` : ""}{l.sqft ? ` · ${l.sqft} sq ft` : ""}{l.daysOnMarket != null ? ` · listed ${l.daysOnMarket} days ago` : ""}
                <LineTags st={l.station} />
              </div>
              <div className="row"><button className="btn sm ghost" onClick={onCheckListing}>🔎 Check before you pay</button></div>
            </div>
          ))}
          {!data.total && <div className="tiny muted">Nothing active under that rent here right now. Try a higher budget or another area.</div>}
          <div className="tiny muted">{data.source}. RentCast doesn't link to the original post; search the address on the sites below.</div>
        </div>
      )}
      {data?.stays && (
        <div className="col" style={{ gap: 8 }}>
          <b className="small">{data.total} {kind}s near {area.label}</b>
          {data.stays.map((p: any) => (
            <div key={p.id} className="card tight col" style={{ gap: 4 }}>
              <div className="row between"><b className="small">{p.name}</b>{p.rating != null && <span className="tag gold">★ {p.rating.toFixed(1)}{p.ratingCount ? ` (${p.ratingCount})` : ""}</span>}</div>
              <div className="tiny muted">{fmtDist(p.distanceM)} away<LineTags st={p.station} /></div>
              <div className="row">
                {p.mapsUrl && <a className="btn sm ghost" href={p.mapsUrl} target="_blank" rel="noopener noreferrer">Prices & photos ↗</a>}
                {p.website && <a className="btn sm ghost" href={p.website} target="_blank" rel="noopener noreferrer">Website ↗</a>}
              </div>
            </div>
          ))}
          <div className="tiny muted">{data.source}. Nightly prices are on Google and the booking sites.</div>
        </div>
      )}
      {kind === "room" && s.me && <button className="btn" onClick={onSublets}>🎓 Verified student sublets in Charlie on the MTA</button>}
      {kind === "dorm" && <div className="tiny muted">Dorms are assigned through your school; the housing office also lists approved off-campus and summer options.</div>}

      {/* pre-filled searches on each site */}
      <div className="card col" style={{ gap: 8 }}>
        <b className="small">Search {monthly ? `under $${budget.toLocaleString()}/mo` : `under $${budget}/night`} near {area.label}</b>
        <div className="row wrap" style={{ gap: 6 }}>
          {links.map((l) => <a key={l.label} className="btn sm" href={l.href} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}
        </div>
        <div className="tiny muted">These open the site's own search; some sites ask you to log in or set the filters again.</div>
      </div>

      <div className="banner warn small col" style={{ gap: 6 }}>
        <b>🛡️ Found one? Check it here before you pay anything.</b>
        <span>Paste the post into the listing check. It flags illegal broker fees, wire or gift-card payments, "I'm abroad, keys by mail" and prices too good to be true.</span>
        <button className="btn sm primary" style={{ alignSelf: "flex-start" }} onClick={onCheckListing}>🔎 Check a listing</button>
      </div>
    </div>
  );
}
