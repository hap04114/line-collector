import { describe, expect, it } from "vitest";
process.env.TZ = "America/New_York";
import { allergenCheck, assessAvailability, budgetFit, compareRanked, evaluate, expandAllergens } from "../src/services/tfield.js";
import { bandOf, estimate, shapeGoogle } from "../src/services/travel.js";
import { nearestDocks, shapeDocks } from "../src/services/bluebikes.js";
import { periodsToOsm, sameName, shapePlace } from "../src/services/googlePlaces.js";

const at = (iso: string) => new Date(iso);
const HOURS = "Mo-Su 11:00-21:00";

describe("availability when you arrive (T-Field R0)", () => {
  it("open with plenty of time", () => expect(assessAvailability({ hours: HOURS }, at("2026-11-23T13:00:00-05:00")).tier).toBe("available"));
  it("closed when you arrive", () => {
    const a = assessAvailability({ hours: HOURS }, at("2026-11-23T22:00:00-05:00"));
    expect(a).toMatchObject({ tier: "unavailable", reasons: ["Closed when you arrive"] });
  });
  it("closing within 30 min of arrival is hidden; within an hour warns", () => {
    expect(assessAvailability({ hours: HOURS }, at("2026-11-23T20:40:00-05:00")).reasons[0]).toBe("Closes 20 min after you arrive");
    const soon = assessAvailability({ hours: HOURS }, at("2026-11-23T20:15:00-05:00"));
    expect(soon.tier).toBe("available");
    expect(soon.warnings).toContain("Closes 45 min after you arrive");
  });
  it("unknown hours is 'probably', closed businesses are out, old info warns", () => {
    expect(assessAvailability({ hours: null }, new Date())).toMatchObject({ tier: "probably", warnings: ["Hours unknown, call ahead"] });
    expect(assessAvailability({ hours: HOURS, businessStatus: "closed_temporarily" }, new Date()).tier).toBe("unavailable");
    const old = assessAvailability({ hours: HOURS, verifiedAt: "2025-01-01" }, at("2026-11-23T13:00:00-05:00"), at("2026-11-23T13:00:00-05:00"));
    expect(old.warnings).toContain("Info may be outdated");
  });
});

describe("allergens (never 'safe')", () => {
  it("expands umbrella terms", () => expect(expandAllergens(["seafood", "peanut"]).sort()).toEqual(["fish", "peanut", "shellfish"]));
  it("hides high risk, warns on elevated, unknown says nothing", () => {
    expect(allergenCheck({ fish: "high" }, ["seafood"])).toBeNull();
    expect(allergenCheck({ sesame: "elevated" }, ["sesame"])).toEqual(["Often contains sesame"]);
    expect(allergenCheck(null, ["milk"])).toEqual([]);
  });
});

describe("budget and ranking", () => {
  it("allows up to 20% over with a warning", () => {
    expect(budgetFit({ priceCents: 900 }, 1000)).toBe("within");
    expect(budgetFit({ priceCents: 1150 }, 1000)).toBe("over");
    expect(budgetFit({ priceCents: 1300 }, 1000)).toBeNull();
    expect(budgetFit({ priceCents: 0 }, 1000)).toBe("unknown");
    expect(budgetFit({ priceCents: 1500, priceMinCents: 800 }, 1000)).toBe("within"); // a real range wins
  });
  it("orders availability, then budget, then score", () => {
    const list = [
      { tier: "probably", budgetFit: "within", cuisineMatch: true, score: 9 },
      { tier: "available", budgetFit: "over", cuisineMatch: true, score: 0 },
      { tier: "available", budgetFit: "within", cuisineMatch: true, score: -5 },
    ] as const;
    expect([...list].sort(compareRanked).map((x) => `${x.tier}/${x.budgetFit}`)).toEqual(["available/within", "available/over", "probably/within"]);
  });
  it("evaluate applies every rule and collects warnings", () => {
    const spot = { hours: HOURS, priceCents: 1100, allergen: { milk: "elevated" }, venueType: "cafe", vibes: [], localOwned: true };
    const o = { arriveAt: at("2026-11-23T20:15:00-05:00"), arriveMin: 8, budgetCents: 1000, avoid: ["milk"], venueTypes: [], showClosed: false };
    const r = evaluate(spot, o)!;
    expect(r.warnings).toEqual(["Closes 45 min after you arrive", "Often contains milk", "A bit over budget"]);
    expect(evaluate(spot, { ...o, venueTypes: ["bakery"] })).toBeNull();
    expect(evaluate(spot, { ...o, arriveAt: at("2026-11-23T23:00:00-05:00") })).toBeNull();
    expect(evaluate(spot, { ...o, arriveAt: at("2026-11-23T23:00:00-05:00"), showClosed: true })?.availability).toBe("unavailable");
  });
});

describe("travel by mode", () => {
  const neu = { lat: 42.3398, lon: -71.0892 }, kendall = { lat: 42.3625, lon: -71.0862 };
  it("bands follow the preset thresholds", () => {
    expect(bandOf(9, "walk")).toBe("near");
    expect(bandOf(25, "t")).toBe("medium");
    expect(bandOf(60, "t")).toBeNull();
  });
  it("estimates walking with the speed slider", () => {
    const normal = estimate("walk", neu, kendall, 1.3), slow = estimate("walk", neu, kendall, 0.9);
    expect(slow.minutes).toBeGreaterThan(normal.minutes);
    expect(normal.source).toBe("estimate");
  });
  it("estimates the T with a transfer when lines differ", () => {
    const t = estimate("t", neu, kendall, 1.3);
    expect(t.steps.map((s) => s.mode)).toEqual(["walk", "transit", "walk"]);
    expect(t.steps[1].text).toContain("transfer");
    expect(t.minutes).toBeLessThan(estimate("walk", neu, kendall, 1.3).minutes);
  });
  it("reads a Google Routes response and folds walking steps", () => {
    const json = { routes: [{ duration: "1500s", distanceMeters: 4200, legs: [{ steps: [
      { travelMode: "WALK", staticDuration: "120s", distanceMeters: 150, navigationInstruction: { instructions: "Head north" } },
      { travelMode: "WALK", staticDuration: "60s", distanceMeters: 80 },
      { travelMode: "TRANSIT", staticDuration: "900s", distanceMeters: 3800, transitDetails: { transitLine: { nameShort: "Green Line E", color: "#00843d" }, headsign: "Medford/Tufts", stopCount: 4, stopDetails: { departureStop: { name: "Northeastern" }, arrivalStop: { name: "Copley" } } } },
    ] }] }] };
    const o = shapeGoogle(json, "t", 1.35)!;
    expect(o).toMatchObject({ source: "google", minutes: 25, band: "medium" });
    expect(o.steps).toHaveLength(2);
    expect(o.steps[0]).toMatchObject({ mode: "walk", minutes: 3, distanceM: 230 });
    expect(o.steps[1]).toMatchObject({ mode: "transit", from: "Northeastern", to: "Copley", stops: 4, text: "Green Line E toward Medford/Tufts" });
    expect(shapeGoogle(json, "t", 0.9)!.minutes).toBe(27); // slower walking adds to the walking legs only
  });
});

describe("Blue Bikes", () => {
  const info = { data: { stations: [{ station_id: "a", name: "Ruggles", lat: 42.336, lon: -71.089, capacity: 19 }, { station_id: "b", name: "Far away", lat: 42.4, lon: -71.2 }] } };
  const status = { data: { stations: [{ station_id: "a", num_bikes_available: 5, num_ebikes_available: 2, num_docks_available: 0, is_renting: 1, is_returning: 1 }, { station_id: "b", num_bikes_available: 1, num_docks_available: 3, is_renting: 1, is_returning: 1 }] } };
  it("joins info and status and finds the nearest usable dock", () => {
    const docks = shapeDocks(info, status);
    expect(docks[0]).toMatchObject({ name: "Ruggles", bikes: 5, ebikes: 2, docks: 0 });
    expect(nearestDocks(docks, 42.3398, -71.0892, "bike")[0].name).toBe("Ruggles");
    expect(nearestDocks(docks, 42.3398, -71.0892, "dock")).toEqual([]); // Ruggles is full, the other is too far
  });
});

describe("Google Places enrichment", () => {
  it("turns opening periods into OSM hours, including past midnight and 24/7", () => {
    expect(periodsToOsm([{ open: { day: 1, hour: 11, minute: 0 }, close: { day: 1, hour: 21, minute: 30 } }, { open: { day: 5, hour: 18, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }])).toBe("Mo 11:00-21:30; Fr 18:00-02:00");
    expect(periodsToOsm([{ open: { day: 0, hour: 0, minute: 0 } }])).toBe("24/7");
  });
  it("only accepts the same place nearby", () => {
    expect(sameName("Amelia's Taqueria", "Amelia’s Taqueria Boston")).toBe(true);
    expect(sameName("Pavement Coffeehouse", "Tatte Bakery")).toBe(false);
    expect(sameName("Mamacitas", "Mamacita Mexican Comida")).toBe(true); // plural "s" only
    expect(sameName("The Eatery at Stetson East", "Food Hall at Stetson West")).toBe(false);
    const spot = { name: "Pavement Coffeehouse", lat: 42.3478, lon: -71.0874 };
    const ok = shapePlace(spot, { id: "x", displayName: { text: "Pavement Coffeehouse" }, location: { latitude: 42.3479, longitude: -71.0875 }, rating: 4.5, userRatingCount: 812, businessStatus: "OPERATIONAL", priceRange: { startPrice: { units: "1" }, endPrice: { units: "10" } } });
    expect(ok).toMatchObject({ matched: true, rating: 4.5, priceMinCents: 100, priceMaxCents: 1000, businessStatus: "operational" });
    expect(shapePlace(spot, { displayName: { text: "Pavement Coffeehouse" }, location: { latitude: 42.36, longitude: -71.06 } }).matched).toBe(false);
  });
});
