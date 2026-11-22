/**
 * Neighborhood stamps: one short line each about what the place is known for.
 * Written to be light and accurate; the team should fact-check before the demo
 * (doc: "The team writes and fact-checks these").
 */
export interface NeighborhoodMeta {
  id: string;
  name: string;
  kind: "boston" | "bonus";
  blurb: string;
  icon: string;
  color: string;
}

export const NEIGHBORHOODS: NeighborhoodMeta[] = [
  { id: "allston", name: "Allston", kind: "boston", icon: "🎸", color: "#F72585", blurb: "Rock clubs, cheap eats and a lot of students along Harvard and Brighton Aves." },
  { id: "back-bay", name: "Back Bay", kind: "boston", icon: "🛍️", color: "#B5838D", blurb: "Victorian brownstones on filled-in marsh, plus Newbury Street and Copley Square." },
  { id: "beacon-hill", name: "Beacon Hill", kind: "boston", icon: "🏛️", color: "#D4A373", blurb: "Gas lamps, brick sidewalks and the gold-domed State House." },
  { id: "brighton", name: "Brighton", kind: "boston", icon: "🍂", color: "#E76F51", blurb: "Leafy and residential, with Cleveland Circle and Oak Square." },
  { id: "charlestown", name: "Charlestown", kind: "boston", icon: "⚓", color: "#457B9D", blurb: "The Bunker Hill Monument and USS Constitution, both on the Freedom Trail." },
  { id: "chinatown", name: "Chinatown", kind: "boston", icon: "🥟", color: "#E63946", blurb: "Dim sum, bakeries and bubble tea around the gate on Beach Street." },
  { id: "dorchester", name: "Dorchester", kind: "boston", icon: "🏘️", color: "#2A9D8F", blurb: "Boston's biggest neighborhood: triple-deckers, and Vietnamese food around Fields Corner." },
  { id: "downtown", name: "Downtown", kind: "boston", icon: "🏙️", color: "#8D99AE", blurb: "Faneuil Hall, Downtown Crossing and the Old State House." },
  { id: "east-boston", name: "East Boston", kind: "boston", icon: "✈️", color: "#3A86FF", blurb: "Across the harbor on the Blue Line, with Latin American food and skyline views." },
  { id: "fenway", name: "Fenway", kind: "boston", icon: "⚾", color: "#2D6A4F", blurb: "Fenway Park, the Museum of Fine Arts and the Back Bay Fens." },
  { id: "hyde-park", name: "Hyde Park", kind: "boston", icon: "🌲", color: "#52B788", blurb: "Boston's southernmost neighborhood, along the Neponset River." },
  { id: "jamaica-plain", name: "Jamaica Plain", kind: "boston", icon: "🌳", color: "#40916C", blurb: "Jamaica Pond, the Arnold Arboretum and Centre Street's indie shops." },
  { id: "longwood", name: "Longwood", kind: "boston", icon: "🏥", color: "#90E0EF", blurb: "The Longwood Medical Area's hospitals and a cluster of colleges." },
  { id: "mattapan", name: "Mattapan", kind: "boston", icon: "🚋", color: "#FFB703", blurb: "Caribbean bakeries and the Mattapan trolley's vintage streetcars." },
  { id: "mission-hill", name: "Mission Hill", kind: "boston", icon: "⛪", color: "#9D4EDD", blurb: "Row houses climbing toward the twin spires of Mission Church." },
  { id: "north-end", name: "North End", kind: "boston", icon: "🍝", color: "#C1121F", blurb: "Boston's Little Italy: cannoli, Paul Revere's House and Old North Church." },
  { id: "roslindale", name: "Roslindale", kind: "boston", icon: "🥖", color: "#DDA15E", blurb: "A walkable village square with bakeries and a seasonal farmers market." },
  { id: "roxbury", name: "Roxbury", kind: "boston", icon: "🎨", color: "#FB8500", blurb: "Nubian Square and the edge of Franklin Park, in one of Boston's oldest neighborhoods." },
  { id: "south-boston", name: "South Boston", kind: "boston", icon: "🏖️", color: "#219EBC", blurb: "Southie: Castle Island, the L Street beach and the St. Patrick's Day parade." },
  { id: "south-boston-waterfront", name: "South Boston Waterfront", kind: "boston", icon: "🌊", color: "#00B4D8", blurb: "The Seaport's new towers, the ICA and long Harborwalk views." },
  { id: "south-end", name: "South End", kind: "boston", icon: "🧱", color: "#BC6C25", blurb: "Bow-front brick row houses, the SoWa market and a big restaurant scene." },
  { id: "west-end", name: "West End", kind: "boston", icon: "🔬", color: "#4CC9F0", blurb: "Mass General and the West End Museum, which tells the story of urban renewal." },
  { id: "west-roxbury", name: "West Roxbury", kind: "boston", icon: "🌄", color: "#6A994E", blurb: "Quiet streets, Centre Street restaurants and Millennium Park's hilltop views." },
  { id: "cambridge", name: "Cambridge", kind: "bonus", icon: "🎓", color: "#7209B7", blurb: "Bonus area: Harvard Square and Kendall's labs, across the river." },
  { id: "medford-somerville", name: "Medford/Somerville", kind: "bonus", icon: "🐘", color: "#4361EE", blurb: "Bonus area: Davis and Union Square food, and Tufts up on the hill." },
];

export const BONUS_BY_MUNICIPALITY: Record<string, string> = {
  Cambridge: "cambridge",
  Somerville: "medford-somerville",
  Medford: "medford-somerville",
};

/** Free Boston landmark hangouts from the doc ("the Boston aesthetic"). */
export const LANDMARKS = [
  { id: "lm-boston-common", name: "Boston Common", stationId: "place-pktrm", lat: 42.35508, lon: -71.06556, blurb: "America's oldest public park. Free, central, always something going on." },
  { id: "lm-public-garden", name: "Public Garden", stationId: "place-armnl", lat: 42.35414, lon: -71.07015, blurb: "Swan Boats in season, the lagoon bridge and Make Way for Ducklings." },
  { id: "lm-esplanade", name: "Charles River Esplanade", stationId: "place-chmnl", lat: 42.35780, lon: -71.07380, blurb: "River paths, the Hatch Shell and sunset over Cambridge." },
  { id: "lm-arboretum", name: "Arnold Arboretum", stationId: "place-forhl", lat: 42.29950, lon: -71.11590, blurb: "Harvard's free 281-acre tree museum. Climb Peters Hill for a skyline view." },
  { id: "lm-harborwalk", name: "Harborwalk at Long Wharf", stationId: "place-aqucl", lat: 42.35960, lon: -71.04990, blurb: "Harbor views by the Aquarium, on neutral Blue Line ground." },
];
