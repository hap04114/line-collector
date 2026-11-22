/**
 * The seven target schools. Colors are in-app team colors picked to be told apart
 * on the map (several schools are officially red), not official branding.
 * Home station ids were checked against the MBTA V3 API (scripts/bake-mbta.ts output).
 * TODO before demo: confirm each school's email domains and subdomains.
 */
export interface School {
  id: string;
  name: string;
  short: string;
  city: string;
  color: string;
  emailDomains: string[];
  homeStations: string[];
  lat: number;
  lon: number;
}

export const SCHOOLS: School[] = [
  {
    id: "neu", name: "Northeastern University", short: "Northeastern", city: "Boston", color: "#EF233C",
    emailDomains: ["northeastern.edu", "husky.neu.edu", "neu.edu"], homeStations: ["place-nuniv", "place-rugg"],
    lat: 42.3398, lon: -71.0892,
  },
  {
    id: "bu", name: "Boston University", short: "BU", city: "Boston", color: "#FF7A00",
    emailDomains: ["bu.edu"], homeStations: ["place-buest", "place-bucen", "place-kencl"],
    lat: 42.3505, lon: -71.1054,
  },
  {
    id: "bc", name: "Boston College", short: "BC", city: "Chestnut Hill", color: "#FFC300",
    emailDomains: ["bc.edu"], homeStations: ["place-lake"],
    lat: 42.3355, lon: -71.1685,
  },
  {
    id: "umb", name: "UMass Boston", short: "UMass Boston", city: "Boston", color: "#00B4D8",
    emailDomains: ["umb.edu"], homeStations: ["place-jfk"],
    lat: 42.3134, lon: -71.0384,
  },
  {
    id: "harvard", name: "Harvard University", short: "Harvard", city: "Cambridge", color: "#C9184A",
    emailDomains: ["harvard.edu"], homeStations: ["place-harsq"],
    lat: 42.3744, lon: -71.1169,
  },
  {
    id: "mit", name: "MIT", short: "MIT", city: "Cambridge", color: "#A8B2BD",
    emailDomains: ["mit.edu"], homeStations: ["place-knncl"],
    lat: 42.3601, lon: -71.0942,
  },
  {
    id: "tufts", name: "Tufts University", short: "Tufts", city: "Medford", color: "#4361EE",
    emailDomains: ["tufts.edu"], homeStations: ["place-mdftf"],
    lat: 42.4075, lon: -71.1190,
  },
];

export const schoolById = (id: string) => SCHOOLS.find((s) => s.id === id) || null;

/** Domain match includes subdomains: g.harvard.edu matches harvard.edu */
export function schoolForEmail(email: string): School | null {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  return SCHOOLS.find((s) => s.emailDomains.some((d) => domain === d || domain.endsWith("." + d))) || null;
}
