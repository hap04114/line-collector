/**
 * $0 Boston: hand-picked free (and nearly free) places for a student with no budget.
 * Prices and opening rules change; anything conditional carries a `check` note so the UI says so.
 * Cheap eats next to each place come live from the spots table (OSM + T-Field diet tags), not from here.
 */

export type FreeCat = "park" | "museum" | "campus" | "view" | "library" | "landmark" | "market";
export type Crew = "solo" | "date" | "friends";

export interface FreePlace {
  id: string;
  name: string;
  cat: FreeCat;
  /** entry cost in cents for a student (0 = free) */
  costCents: number;
  /** shown under the price: what makes it free, or what it costs extra */
  costNote?: string;
  /** a rule worth checking before going (student ID program, free nights, seasons) */
  check?: string;
  stationId: string;
  lat: number;
  lon: number;
  /** how long people usually stay */
  minutes: number;
  blurb: string;
  /** the insider move */
  hack: string;
  crew: Crew[];
  indoor: boolean;
  sunset?: boolean;
  /** optional cheap add-on when the budget allows */
  treat?: { label: string; cents: number };
}

export const FREE_CATS: { id: FreeCat; label: string; icon: string }[] = [
  { id: "park", label: "Parks", icon: "🌳" },
  { id: "museum", label: "Museums", icon: "🖼️" },
  { id: "campus", label: "Campuses", icon: "🎓" },
  { id: "view", label: "Views", icon: "🌇" },
  { id: "library", label: "Libraries", icon: "📚" },
  { id: "landmark", label: "Landmarks", icon: "🏛️" },
  { id: "market", label: "Markets", icon: "🛍️" },
];

export const FREE_PLACES: FreePlace[] = [
  // ---- Fenway / Kenmore / Fens ----
  {
    id: "fb-fenway-park", name: "Fenway Park (outside)", cat: "landmark", costCents: 0, costNote: "Free to walk around · tours and games are paid",
    stationId: "place-kencl", lat: 42.34665, lon: -71.09719, minutes: 40,
    blurb: "America's oldest ballpark. Jersey Street turns into a street party on game days.",
    hack: "Walk Lansdowne St under the Green Monster before first pitch. You can hear the crowd for free.",
    crew: ["friends", "date", "solo"], indoor: false, treat: { label: "Fenway Frank from a street cart", cents: 500 },
  },
  {
    id: "fb-fens-rose-garden", name: "Back Bay Fens & Kelleher Rose Garden", cat: "park", costCents: 0, costNote: "Free",
    check: "Roses bloom roughly June to September",
    stationId: "place-fenwy", lat: 42.34182, lon: -71.09505, minutes: 45,
    blurb: "A hidden walled rose garden inside the Emerald Necklace, five minutes from Fenway.",
    hack: "Bring a sandwich and take a bench inside the garden walls. It's the quietest date spot near campus.",
    crew: ["date", "solo"], indoor: false,
  },
  {
    id: "fb-mfa", name: "Museum of Fine Arts", cat: "museum", costCents: 0, costNote: "Free with many Boston university IDs",
    check: "Free entry depends on your school being an MFA university member. Check mfa.org before going.",
    stationId: "place-mfa", lat: 42.33938, lon: -71.09403, minutes: 120,
    blurb: "500,000 works, from Egyptian mummies to Monet. One of the best museums in the country.",
    hack: "Grab a map at the desk and pick one wing. Trying to see all of it in one visit wears you out.",
    crew: ["date", "solo", "friends"], indoor: true,
  },
  {
    id: "fb-gardner", name: "Isabella Stewart Gardner Museum", cat: "museum", costCents: 1500, costNote: "Student ticket, est.",
    check: "Free if your name is Isabella, and free on your birthday",
    stationId: "place-mfa", lat: 42.33817, lon: -71.09906, minutes: 90,
    blurb: "A Venetian palace with a flowering courtyard and the empty frames from the 1990 art heist.",
    hack: "Look for the empty frames. The stolen paintings were never found, and the frames stay up until they are.",
    crew: ["date", "solo"], indoor: true,
  },
  {
    id: "fb-christian-science-plaza", name: "Christian Science Plaza", cat: "landmark", costCents: 0, costNote: "Free · Mapparium is paid",
    stationId: "place-symcl", lat: 42.34455, lon: -71.08530, minutes: 25,
    blurb: "A 670-foot reflecting pool with skyline reflections between Symphony and the Pru.",
    hack: "Come at blue hour. The Pru reflects in the pool, which makes it one of the best free photo spots in Boston.",
    crew: ["date", "solo", "friends"], indoor: false, sunset: true,
  },
  // ---- Back Bay / Copley ----
  {
    id: "fb-bpl", name: "Boston Public Library, Central", cat: "library", costCents: 0, costNote: "Free · free library card for MA students",
    stationId: "place-coecl", lat: 42.34936, lon: -71.07823, minutes: 60,
    blurb: "Bates Hall's green lamps, murals by Sargent, and an Italian courtyard in the middle of Copley.",
    hack: "Find the courtyard through the McKim building. A free card also gets you free museum passes.",
    crew: ["solo", "date"], indoor: true,
  },
  {
    id: "fb-newbury", name: "Newbury Street window walk", cat: "landmark", costCents: 0, costNote: "Free to look",
    stationId: "place-coecl", lat: 42.35050, lon: -71.08070, minutes: 45,
    blurb: "Eight blocks of brownstones, street art and shop windows from the Public Garden to Mass Ave.",
    hack: "Start at Arlington and walk toward Mass Ave. The shops get cheaper and the thrift stores start near the end.",
    crew: ["friends", "date"], indoor: false, treat: { label: "Ice cream cone", cents: 600 },
  },
  // ---- River / Cambridge ----
  {
    id: "fb-esplanade", name: "Charles River Esplanade", cat: "park", costCents: 0, costNote: "Free",
    stationId: "place-chmnl", lat: 42.35780, lon: -71.07380, minutes: 60,
    blurb: "Three miles of riverbank: docks, the Hatch Shell, and sailboats in front of MIT.",
    hack: "Sit on the lagoon docks at sunset. The Hatch Shell hosts free concerts and movies in summer.",
    crew: ["date", "friends", "solo"], indoor: false, sunset: true,
  },
  {
    id: "fb-harvard-bridge", name: "Harvard Bridge (the Smoot bridge)", cat: "view", costCents: 0, costNote: "Free",
    stationId: "place-hymnl", lat: 42.35460, lon: -71.09200, minutes: 25,
    blurb: "The Mass Ave bridge to MIT, measured in Smoots: 364.4 of them, plus an ear.",
    hack: "Count the Smoot marks painted on the sidewalk on your way across. The view back at Back Bay is the best in Boston.",
    crew: ["date", "friends", "solo"], indoor: false, sunset: true,
  },
  {
    id: "fb-longfellow", name: "Longfellow Bridge walk", cat: "view", costCents: 0, costNote: "Free",
    stationId: "place-chmnl", lat: 42.36160, lon: -71.07580, minutes: 25,
    blurb: "The 'salt and pepper' bridge. Red Line trains rumble past while you walk to Kendall.",
    hack: "Walk it from Boston to Cambridge at dusk, then ride the Red Line one stop back over the same bridge.",
    crew: ["date", "solo"], indoor: false, sunset: true,
  },
  {
    id: "fb-mit", name: "MIT campus: Great Dome & Infinite Corridor", cat: "campus", costCents: 0, costNote: "Free · List Visual Arts Center is free too",
    stationId: "place-knncl", lat: 42.35920, lon: -71.09200, minutes: 60,
    blurb: "Killian Court, the Great Dome, Gehry's twisted Stata Center and public art all over campus.",
    hack: "Walk the Infinite Corridor end to end. Twice a year at 'MIThenge' the sunset lines up straight down it.",
    crew: ["friends", "solo", "date"], indoor: true,
  },
  {
    id: "fb-harvard-yard", name: "Harvard Yard & Harvard Square", cat: "campus", costCents: 0, costNote: "Free",
    stationId: "place-harsq", lat: 42.37440, lon: -71.11690, minutes: 60,
    blurb: "Red brick, the John Harvard statue, buskers in the Pit and used bookstores.",
    hack: "The square's buskers are best on weekend evenings. Then browse the used bookstores, which cost nothing to look.",
    crew: ["friends", "date", "solo"], indoor: false, treat: { label: "Pastry from a Square café", cents: 500 },
  },
  // ---- Downtown / Beacon Hill ----
  {
    id: "fb-common", name: "Boston Common & Public Garden", cat: "park", costCents: 0, costNote: "Free · Swan Boats are paid, in season",
    stationId: "place-pktrm", lat: 42.35508, lon: -71.06556, minutes: 50,
    blurb: "America's oldest park, the lagoon bridge, and the Make Way for Ducklings statues.",
    hack: "Dress the duckling statues up with your friends. Locals do it for every holiday.",
    crew: ["friends", "date", "solo"], indoor: false, treat: { label: "Swan Boat ride (seasonal), est.", cents: 600 },
  },
  {
    id: "fb-acorn", name: "Acorn Street, Beacon Hill", cat: "landmark", costCents: 0, costNote: "Free",
    stationId: "place-chmnl", lat: 42.35760, lon: -71.07000, minutes: 25,
    blurb: "The cobblestone lane that gets called 'the most photographed street in America'.",
    hack: "Go early on a weekend morning to get it without crowds, then walk Charles Street's gas lamps.",
    crew: ["date", "friends"], indoor: false,
  },
  {
    id: "fb-state-house", name: "Massachusetts State House", cat: "landmark", costCents: 0, costNote: "Free guided tours on weekdays",
    check: "Bring a photo ID for security",
    stationId: "place-pktrm", lat: 42.35880, lon: -71.06380, minutes: 45,
    blurb: "The gold dome. Inside are the Sacred Cod and the chamber where state laws get made.",
    hack: "Ask the guide about the Sacred Cod. It has been stolen by Harvard pranksters before.",
    crew: ["solo", "friends"], indoor: true,
  },
  {
    id: "fb-freedom-trail", name: "Freedom Trail (self-guided)", cat: "landmark", costCents: 0, costNote: "Free on your own · guided tours are paid",
    stationId: "place-pktrm", lat: 42.35540, lon: -71.06360, minutes: 150,
    blurb: "2.5 miles of red brick line through 16 historic sites, from the Common to Bunker Hill.",
    hack: "Skip the costumed tour. Follow the red line on the sidewalk and read the plaques yourself.",
    crew: ["friends", "solo"], indoor: false,
  },
  {
    id: "fb-faneuil", name: "Faneuil Hall & Quincy Market", cat: "market", costCents: 0, costNote: "Free to wander",
    stationId: "place-state", lat: 42.36000, lon: -71.05480, minutes: 45,
    blurb: "Street performers on the cobblestones and a long food hall packed with stalls.",
    hack: "Street performers draw the biggest circles on weekend afternoons. Watching is free and they deserve a dollar.",
    crew: ["friends", "date"], indoor: true, treat: { label: "Clam chowder in a cup", cents: 800 },
  },
  {
    id: "fb-north-end", name: "North End & Paul Revere Mall", cat: "landmark", costCents: 0, costNote: "Free to explore",
    stationId: "place-haecl", lat: 42.36540, lon: -71.05360, minutes: 60,
    blurb: "Boston's Little Italy: narrow streets, Old North Church, and Hanover Street bakeries.",
    hack: "The cannoli line debate is half the fun. Split one with your crew and argue about which bakery wins.",
    crew: ["date", "friends"], indoor: false, treat: { label: "Cannoli on Hanover St, est.", cents: 600 },
  },
  {
    id: "fb-public-market", name: "Boston Public Market", cat: "market", costCents: 0, costNote: "Free entry",
    stationId: "place-haecl", lat: 42.36200, lon: -71.05730, minutes: 40,
    blurb: "An indoor market of New England farmers and makers. Warm on a cold day.",
    hack: "Vendors often hand out free samples. On Fridays and Saturdays, Haymarket's produce carts outside sell fruit dirt cheap.",
    crew: ["friends", "date", "solo"], indoor: true, treat: { label: "Cider donut", cents: 300 },
  },
  {
    id: "fb-greenway", name: "Rose Kennedy Greenway", cat: "park", costCents: 0, costNote: "Free · carousel is paid",
    stationId: "place-aqucl", lat: 42.35920, lon: -71.05260, minutes: 40,
    blurb: "A 1.5-mile ribbon of gardens, fountains, murals and food trucks where the highway used to be.",
    hack: "Food trucks line up along it at lunchtime, and the Rings Fountain is free to run through in summer.",
    crew: ["friends", "date"], indoor: false,
  },
  {
    id: "fb-harborwalk", name: "Harborwalk & Long Wharf", cat: "view", costCents: 0, costNote: "Free",
    stationId: "place-aqucl", lat: 42.35960, lon: -71.04990, minutes: 35,
    blurb: "Watch planes land over the harbor from the end of Long Wharf, next to the Aquarium.",
    hack: "The Aquarium's harbor seal tank is visible from the outside plaza for free.",
    crew: ["date", "solo", "friends"], indoor: false, sunset: true,
  },
  {
    id: "fb-chinatown", name: "Chinatown Gate & Beach Street", cat: "landmark", costCents: 0, costNote: "Free to wander",
    stationId: "place-chncl", lat: 42.35100, lon: -71.05980, minutes: 40,
    blurb: "The paifang gate, bakeries and bubble tea, open later than most of downtown.",
    hack: "Bakeries here sell buns for a couple of dollars. Best cheap snack crawl in the city.",
    crew: ["friends", "date"], indoor: false, treat: { label: "Bubble tea", cents: 600 },
  },
  // ---- Charlestown / East Boston ----
  {
    id: "fb-bunker-hill", name: "Bunker Hill Monument", cat: "view", costCents: 0, costNote: "Free · 294 steps to the top",
    check: "The climb is run by the National Park Service; hours vary by season",
    stationId: "place-ccmnl", lat: 42.37630, lon: -71.06080, minutes: 45,
    blurb: "A 221-foot granite obelisk. Climb all 294 steps for a 360° view of the harbor.",
    hack: "It counts as leg day. The view from the top is free, which a skyscraper observation deck isn't.",
    crew: ["friends", "solo"], indoor: true,
  },
  {
    id: "fb-uss-constitution", name: "USS Constitution", cat: "museum", costCents: 0, costNote: "Free · bring photo ID",
    stationId: "place-ccmnl", lat: 42.37240, lon: -71.05660, minutes: 50,
    blurb: "'Old Ironsides', the oldest commissioned warship still afloat. Sailors give the tours.",
    hack: "Ask the sailors on deck anything. They are active-duty Navy, and the tour costs nothing.",
    crew: ["friends", "solo"], indoor: false,
  },
  {
    id: "fb-piers-park", name: "Piers Park, East Boston", cat: "view", costCents: 0, costNote: "Free",
    stationId: "place-mvbcl", lat: 42.36330, lon: -71.03470, minutes: 45,
    blurb: "The postcard view of the whole downtown skyline across the water. Most students never go.",
    hack: "Ride the Blue Line to Maverick at sunset and walk ten minutes. The skyline lights up right in front of you.",
    crew: ["date", "solo"], indoor: false, sunset: true,
  },
  // ---- Seaport / South End ----
  {
    id: "fb-seaport", name: "Fan Pier & the ICA waterfront", cat: "museum", costCents: 0, costNote: "Waterfront free · ICA has free nights",
    check: "ICA runs free Thursday nights. Check icaboston.org for this week's hours.",
    stationId: "place-sstat", lat: 42.35280, lon: -71.04280, minutes: 60,
    blurb: "Glass museum cantilevered over the harbor, plus a long waterfront walk past the boats.",
    hack: "Sit on the ICA's wooden harbor steps. They are outside and free, even when the museum is closed.",
    crew: ["date", "friends", "solo"], indoor: true, sunset: true,
  },
  {
    id: "fb-sowa", name: "SoWa Open Market", cat: "market", costCents: 0, costNote: "Free entry",
    check: "Sundays, roughly May to October",
    stationId: "place-tumnl", lat: 42.34200, lon: -71.06600, minutes: 60,
    blurb: "A weekly market of artists, vintage sellers and food trucks in the South End.",
    hack: "Go at the end of the day. Some vendors cut prices before they pack up.",
    crew: ["friends", "date"], indoor: false, treat: { label: "Food truck taco", cents: 500 },
  },
  {
    id: "fb-castle-island", name: "Castle Island & Pleasure Bay", cat: "park", costCents: 0, costNote: "Free",
    stationId: "place-brdwy", lat: 42.33780, lon: -71.01200, minutes: 75,
    blurb: "A granite fort, a loop around Pleasure Bay, and planes low overhead from Logan.",
    hack: "From Broadway it's a long walk or a bus ride. Do the full Pleasure Bay loop, then split fries at the snack stand.",
    crew: ["friends", "date"], indoor: false, sunset: true, treat: { label: "Fries at the snack stand, est.", cents: 500 },
  },
  // ---- Emerald Necklace / Brookline ----
  {
    id: "fb-arboretum", name: "Arnold Arboretum", cat: "park", costCents: 0, costNote: "Free",
    stationId: "place-forhl", lat: 42.29950, lon: -71.11590, minutes: 90,
    blurb: "Harvard's 281-acre tree museum. In spring it's lilac and cherry blossom season.",
    hack: "Hike up Peters Hill for a skyline view almost nobody knows about. Lilac Sunday in May is free.",
    crew: ["date", "solo", "friends"], indoor: false, sunset: true,
  },
  {
    id: "fb-jamaica-pond", name: "Jamaica Pond", cat: "park", costCents: 0, costNote: "Free",
    stationId: "place-grnst", lat: 42.31600, lon: -71.12000, minutes: 50,
    blurb: "A 1.5-mile loop around a glacial kettle pond. Locals run it, and it's lovely at golden hour.",
    hack: "The loop takes about 30 minutes. Walk it, then get a JP coffee on Centre Street.",
    crew: ["date", "solo"], indoor: false, sunset: true,
  },
  {
    id: "fb-corey-hill", name: "Corey Hill Outlook", cat: "view", costCents: 0, costNote: "Free",
    stationId: "place-bcnwa", lat: 42.34330, lon: -71.12810, minutes: 30,
    blurb: "A little Brookline park on a hill with a wide view of the Boston skyline.",
    hack: "Bring a blanket for sunset. You'll mostly share it with locals walking their dogs.",
    crew: ["date", "solo"], indoor: false, sunset: true,
  },
];

/** Fun, honest $0 tips that apply anywhere. */
export const BROKE_HACKS = [
  { icon: "🪪", title: "Your student ID is a skeleton key", body: "Many museums, theaters and even the MFA give free or cheap entry with a Boston school ID. Always ask at the desk." },
  { icon: "📚", title: "A BPL card is free museum passes", body: "Massachusetts residents and students can get a free Boston Public Library card, and the library lends discount museum passes." },
  { icon: "🎶", title: "Summer is free-concert season", body: "Hatch Shell concerts and movies, Shakespeare on the Common, and free outdoor fitness classes all run in summer." },
  { icon: "🥪", title: "Picnic beats restaurant", body: "Grab groceries and eat on the Esplanade or the Common. Same view as a rooftop bar, for under $8." },
  { icon: "🚶", title: "Walk one stop, save a fare", body: "Downtown stations sit 5–10 minutes apart on foot. Walking between them is free, and you'll see more than from a tunnel." },
];
