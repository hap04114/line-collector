export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (bLat - aLat) * toR, dLon = (bLon - aLon) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

type Ring = [number, number][];

/** Ray casting; ring coords are [lon, lat] */
function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(lon: number, lat: number, geom: { type: string; coordinates: any }): boolean {
  const polys: Ring[][] = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  for (const poly of polys) {
    if (!inRing(lon, lat, poly[0])) continue;
    if (poly.slice(1).some((hole) => inRing(lon, lat, hole))) continue;
    return true;
  }
  return false;
}

/** Walking minutes for a straight-line distance (1.3 detour factor, 80 m/min). */
export const walkMinutes = (m: number) => Math.max(1, Math.round((m * 1.3) / 80));
