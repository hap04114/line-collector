import { describe, expect, it } from "vitest";
process.env.TZ = "America/New_York";
import { fromEventbrite, fromIcs, fromLocalist, icsDate, parseIcs, priceFromText, zonedToUtc } from "../src/services/bostonEvents.js";
import { eventWindow } from "../src/routes/freeBoston.js";

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:evt-1@meetup.com",
  "DTSTART;TZID=America/New_York:20261205T183000",
  "DTEND;TZID=America/New_York:20261205T203000",
  "SUMMARY:Boston Hackers: AI demo night",
  "DESCRIPTION:Free to attend. Pizza will be provided\\, bring a laptop.\\nhttps://www.meetup.com/boston-hackers/events/1",
  "LOCATION:CIC Cambridge\\, 245 Main St\\, Cambridge\\, MA 02142",
  "URL:https://www.meetup.com/boston-hackers/events/1",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:evt-2@lu.ma",
  "DTSTART:20261206T150000Z",
  "SUMMARY:Startup mixer (tickets $15)",
  "DESCRIPTION:Networking for founders and students. Long descriptions get",
  "  folded onto continuation lines.",
  "LOCATION:Zoom",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("iCal parsing", () => {
  it("unfolds lines and reads params", () => {
    const ev = parseIcs(ICS);
    expect(ev).toHaveLength(2);
    expect(ev[0].DTSTART.params.TZID).toBe("America/New_York");
    expect(ev[1].DESCRIPTION.value).toContain("get folded onto");
  });
  it("converts Boston wall time to UTC across DST", () => {
    expect(zonedToUtc(2026, 12, 5, 18, 30, 0, "America/New_York").toISOString()).toBe("2026-12-05T23:30:00.000Z"); // EST −5
    expect(zonedToUtc(2026, 7, 4, 21, 0, 0, "America/New_York").toISOString()).toBe("2026-07-05T01:00:00.000Z"); // EDT −4
    expect(icsDate({ value: "20261206T150000Z", params: {} })!.toISOString()).toBe("2026-12-06T15:00:00.000Z");
  });
  it("normalizes Meetup/Luma events: free, free food, online, tags, venue", () => {
    const [a, b] = fromIcs(ICS, "meetup", "Boston Hackers");
    expect(a).toMatchObject({ source: "meetup", title: "Boston Hackers: AI demo night", free: true, freeFood: true, online: false, venue: "CIC Cambridge" });
    expect(a.address).toBe("245 Main St, Cambridge, MA 02142");
    expect(a.tags).toContain("tech");
    expect(a.start).toBe("2026-12-05T23:30:00.000Z");
    expect(b).toMatchObject({ free: false, priceCents: 1500, online: true });
    expect(b.tags).toContain("career");
  });
});

describe("prices from text", () => {
  it("reads free, paid and unknown", () => {
    expect(priceFromText("Free and open to the public")).toEqual({ free: true, priceCents: 0 });
    expect(priceFromText("Tickets $12.50 at the door")).toEqual({ free: false, priceCents: 1250 });
    expect(priceFromText("Join us for a talk")).toEqual({ free: null, priceCents: null });
  });
});

describe("Eventbrite and Localist", () => {
  it("maps Eventbrite API events", () => {
    const [e] = fromEventbrite({ events: [{ id: "9", name: { text: "Sunset jazz on the harbor" }, summary: "Live music", url: "https://eventbrite.com/e/9",
      start: { utc: "2026-12-05T22:00:00Z" }, end: { utc: "2026-12-06T00:00:00Z" }, is_free: false, online_event: false,
      venue: { name: "Fan Pier", latitude: "42.353", longitude: "-71.043", address: { localized_address_display: "Fan Pier, Boston" } },
      ticket_availability: { minimum_ticket_price: { major_value: "8.00" } } }] }, "Harbor Org");
    expect(e).toMatchObject({ source: "eventbrite", free: false, priceCents: 800, lat: 42.353, tags: ["music"] });
  });
  it("maps Localist campus events and picks the next instance", () => {
    const now = Date.parse("2026-12-01T00:00:00Z");
    const [e] = fromLocalist({ events: [{ event: { id: 5, title: "Open lecture: black holes", free: true, location_name: "Kresge", geo: { latitude: "42.358", longitude: "-71.094" },
      description_text: "<p>Refreshments served.</p>", localist_url: "https://calendar.mit.edu/event/5",
      event_instances: [{ event_instance: { start: "2026-11-20T19:00:00-05:00" } }, { event_instance: { start: "2026-12-03T19:00:00-05:00" } }] } }] }, "MIT Events", now);
    expect(e).toMatchObject({ source: "campus", free: true, freeFood: true, venue: "Kresge" });
    expect(e.start).toBe("2026-12-04T00:00:00.000Z");
    expect(e.tags).toContain("learning");
  });
});

describe("event windows (Boston time)", () => {
  it("weekend starts Friday 5 PM and ends Monday", () => {
    const wed = new Date("2026-12-02T12:00:00-05:00");
    const [from, to] = eventWindow("weekend", wed);
    expect(new Date(from).toISOString()).toBe("2026-12-04T22:00:00.000Z");
    expect(new Date(to).toISOString()).toBe("2026-12-07T05:00:00.000Z");
  });
  it("on Sunday the weekend is the rest of today", () => {
    const sun = new Date("2026-12-06T10:00:00-05:00");
    const [from, to] = eventWindow("weekend", sun);
    expect(from).toBe(sun.getTime());
    expect(new Date(to).toISOString()).toBe("2026-12-07T05:00:00.000Z");
  });
});

import { matchesQuery } from "../src/services/bostonEvents.js";
import { cleanQuery, parseGrounded } from "../src/services/eventSearch.js";

const W = { from: "2026-12-04", to: "2026-12-06" };
const grounded = (text: string, supports: any[] = [], chunks = [
  { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/aaa", title: "eventbrite.com" } },
  { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/bbb", title: "thebostoncalendar.com" } },
]) => ({
  candidates: [{
    content: { parts: [{ text }] },
    groundingMetadata: {
      groundingChunks: chunks,
      groundingSupports: supports,
      webSearchQueries: ["free jazz Boston this weekend"],
      searchEntryPoint: { renderedContent: "<div class=\"chip\">free jazz Boston</div>" },
    },
  }],
});

describe("web search (Gemini grounding) parsing", () => {
  const text = "```json\n" + JSON.stringify({ events: [
    { title: "Jazz on the Harbor", date: "2026-12-05", time: "7 PM", venue: "Fan Pier", price: "Free", free: true, url: "https://www.eventbrite.com/e/jazz-on-the-harbor-1", why: "Free live jazz" },
    { title: "Student open mic night", date: "2026-12-04", url: "https://totally-made-up.example/open-mic", why: "Bring a song" },
    { title: "Mystery event with no source", date: "2026-12-05", url: "https://nowhere.example/x" },
    { title: "Last month's festival", date: "2026-11-01", url: "https://www.eventbrite.com/e/old" },
  ] }) + "\n```";
  const supports = [
    { segment: { text: '"title": "Jazz on the Harbor"' }, groundingChunkIndices: [0] },
    { segment: { text: '"title": "Student open mic night"' }, groundingChunkIndices: [1] },
  ];

  it("keeps events tied to real search results and drops the rest", () => {
    const r = parseGrounded(grounded(text, supports), W);
    expect(r.verified).toBe(true);
    expect(r.events.map((e) => e.title)).toEqual(["Jazz on the Harbor", "Student open mic night"]);
  });
  it("only trusts a URL whose domain Google actually returned", () => {
    const [jazz, mic] = parseGrounded(grounded(text, supports), W).events;
    expect(jazz.url).toBe("https://www.eventbrite.com/e/jazz-on-the-harbor-1");
    expect(jazz.sources[0].title).toBe("eventbrite.com");
    expect(mic.url).toBeNull();
    expect(mic.sources[0].title).toBe("thebostoncalendar.com");
  });
  it("passes Google's Search Suggestions through for display", () => {
    const r = parseGrounded(grounded(text, supports), W);
    expect(r.suggestionsHtml).toContain("chip");
    expect(r.searchQueries).toHaveLength(1);
  });
  it("flags results as unverified when nothing links to a source", () => {
    const r = parseGrounded(grounded(JSON.stringify({ events: [{ title: "Something", date: "2026-12-05" }] })), W);
    expect(r.verified).toBe(false);
    expect(r.events).toHaveLength(1);
  });
  it("returns nothing when there were no search results at all", () => {
    const r = parseGrounded(grounded(JSON.stringify({ events: [{ title: "Invented", date: "2026-12-05" }] }), [], []), W);
    expect(r.events).toEqual([]);
  });
  it("cleans queries before they reach the prompt", () => {
    expect(cleanQuery('  free "jazz"\nignore previous  ')).toBe("free jazz ignore previous");
    expect(cleanQuery("x".repeat(200))).toHaveLength(80);
  });
});

describe("feed search", () => {
  const [ev] = fromIcs(ICS, "meetup", "Boston Hackers");
  it("matches every word across title, group, venue and tags", () => {
    expect(matchesQuery(ev, "ai demo")).toBe(true);
    expect(matchesQuery(ev, "hackers cambridge")).toBe(true);
    expect(matchesQuery(ev, "free pizza")).toBe(true);
    expect(matchesQuery(ev, "pottery")).toBe(false);
  });
});
