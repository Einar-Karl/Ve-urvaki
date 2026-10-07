// Forecast regions. Keep ids/coordinates in sync with REG in src/data.js (which stores [lon, lat]).
// `marine` is an offshore point for wave data (inland regions have none).
export const REGIONS = {
  rvk:   { name: 'Höfuðborgarsvæði', lat: 64.10, lon: -21.90, marine: { lat: 64.25, lon: -22.10 } },
  rnes:  { name: 'Reykjanes',        lat: 63.90, lon: -22.40, marine: { lat: 63.75, lon: -22.70 } },
  west:  { name: 'Snæfellsnes',      lat: 64.85, lon: -23.30, marine: { lat: 64.95, lon: -23.90 } },
  hl:    { name: 'Langjökull',       lat: 64.65, lon: -20.10 },
  south: { name: 'Suðurland',        lat: 63.62, lon: -19.60 },
  se:    { name: 'Suðausturland',    lat: 64.10, lon: -16.30 },
  north: { name: 'Norðurland',       lat: 65.80, lon: -17.30, marine: { lat: 66.15, lon: -17.30 } },
};

export function haversineKm(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearestRegion(p, maxKm = 80) {
  let best = null;
  for (const [id, r] of Object.entries(REGIONS)) {
    const d = haversineKm(p, r);
    if (d <= maxKm && (!best || d < best.km)) best = { id, km: Math.round(d) };
  }
  return best;
}
