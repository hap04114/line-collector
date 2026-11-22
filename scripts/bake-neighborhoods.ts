/**
 * Bakes Boston's neighborhood boundaries (Analyze Boston, "Boston Neighborhood
 * Boundaries Approximated by 2020 Census Tracts") into data/neighborhoods.geojson.
 * Harbor Islands is dropped (no T service), leaving Boston's 23 neighborhoods.
 * Cambridge and Medford/Somerville are bonus areas resolved by station municipality.
 *
 *   npm run bake:neighborhoods
 */
import { getJson, writeData } from "./lib.js";

const URL =
  "https://data.boston.gov/dataset/5997399b-c665-4600-848f-a2a32834f009/resource/42a271c9-486d-4f9e-adc2-63e4bf47fe3e/download/boston_neighborhood_boundaries_approximated_by_2020_census_tracts.geojson";

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const round = (c: any): any => (typeof c[0] === "number" ? [+c[0].toFixed(5), +c[1].toFixed(5)] : c.map(round));

async function main() {
  const gj = await getJson(URL, { headers: { "User-Agent": "Mozilla/5.0 (compatible; LineCollector/0.1)" } });
  const features = gj.features
    .filter((f: any) => f.properties.neighborhood !== "Harbor Islands")
    .map((f: any) => ({
      type: "Feature",
      properties: { id: slug(f.properties.neighborhood), name: f.properties.neighborhood },
      geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
    }));
  writeData("neighborhoods.geojson", {
    type: "FeatureCollection",
    source: "Analyze Boston: Boston Neighborhood Boundaries Approximated by 2020 Census Tracts",
    features,
  });
  console.log(`${features.length} neighborhoods`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
