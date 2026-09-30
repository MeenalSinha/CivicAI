// Geographic helpers. Region boundaries are modelled as centroid+radius by default
// (bbox/polygons can be supplied by a boundary adapter; see adapters/).
export const toRad = d => d * Math.PI / 180;

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32) so synthetic data and jitter are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Deterministic point inside a circle around (lat,lng); same seed -> same point. */
export function jitterAround(center, radiusKm, seedStr) {
  const r = rng(hashString(seedStr));
  const dist = Math.sqrt(r()) * radiusKm;
  const ang = r() * 2 * Math.PI;
  const dLat = (dist * Math.cos(ang)) / 111.32;
  const dLng = (dist * Math.sin(ang)) / (111.32 * Math.cos(toRad(center.lat)));
  return { lat: center.lat + dLat, lng: center.lng + dLng };
}

/** Assign a coordinate to the nearest region; flags whether it lies within the region radius. */
export function findRegion(point, regions) {
  if (!regions?.length || point?.lat == null || point?.lng == null) return null;
  let best = null;
  for (const r of regions) {
    const d = haversineKm(point, { lat: r.lat, lng: r.lng });
    const norm = d / (r.radiusKm || 3);
    if (!best || norm < best.norm) best = { region: r, distanceKm: d, norm };
  }
  return { region: best.region, distanceKm: best.distanceKm, withinRadius: best.norm <= 1 };
}

export function circleAreaKm2(radiusKm) { return Math.PI * radiusKm * radiusKm; }
