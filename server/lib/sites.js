// Forecast "sites": the 7 regions (for the map wind field) plus one point per configured tour
// (id "tour:<id>"), so each tour is forecast at its own meeting point instead of a regional centre.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REGIONS, nearestRegion } from './regions.js';

const FILE = () => process.env.TOURS_FILE || fileURLToPath(new URL('../../config/tours.json', import.meta.url));
export const tourFile = FILE;

// Must match TYPES in src/data.js.
export const TOUR_TYPES = ['snow', 'hike', 'cave', 'snork', 'aurora', 'whale', 'jeep', 'raft', 'atv'];

export function validateTours(tours) {
  const w = [], ids = new Set();
  for (const t of tours) {
    const n = `Tour ${t.id ?? '?'} "${t.name ?? ''}"`;
    if (t.id == null) w.push(`${n}: missing id`);
    else if (ids.has(t.id)) w.push(`${n}: duplicate id`);
    else ids.add(t.id);
    if (!TOUR_TYPES.includes(t.type)) w.push(`${n}: unknown type "${t.type}" (use ${TOUR_TYPES.join(', ')}) — tour is ignored`);
    if (typeof t.lat !== 'number' || typeof t.lon !== 'number') w.push(`${n}: lat/lon must be numbers — forecast falls back to the region`);
    if (!Array.isArray(t.departures) || !t.departures.length || t.departures.some(x => !/^\d{1,2}:\d\d$/.test(x))) w.push(`${n}: departures must be a list like ["09:00","13:00"]`);
    if (!(t.capacity > 0)) w.push(`${n}: capacity must be > 0`);
    if (t.roads != null && !(Array.isArray(t.roads) && t.roads.every(x => typeof x === 'string'))) w.push(`${n}: roads must be a list of road-section names or ids`);
    if (t.limits != null) {
      const ok = typeof t.limits === 'object' && Object.entries(t.limits).every(([k, v]) => ['g', 'p', 'c', 's', 't'].includes(k) && Array.isArray(v) && v.length === 2 && v[0] < v[1] && v.every(Number.isFinite));
      if (!ok) w.push(`${n}: limits must look like {"g":[16,27]} — [risk starts, cancel point] for g (gust m/s), p (rain mm/h), c (cloud %), s (waves m), t (°C); ignored`);
    }
    if (process.env.BOKUN_ACCESS_KEY && !t.bokunProductId) w.push(`${n}: no bokunProductId — bookings for this tour will not load from Bókun`);
  }
  return w;
}

export function readTours() {
  const j = JSON.parse(readFileSync(FILE(), 'utf8'));
  const raw = j.tours || [];
  const tours = raw.map(t => ({ ...t, region: t.region && REGIONS[t.region] ? t.region : (typeof t.lat === 'number' && nearestRegion(t, 200)?.id) || 'rvk' }));
  return { demo: j.demo !== false, tours, warnings: validateTours(raw) };
}

export function buildSites(tours) {
  const sites = { ...REGIONS };
  for (const t of tours) {
    if (typeof t.lat !== 'number' || typeof t.lon !== 'number') continue;
    sites[`tour:${t.id}`] = { name: t.name, lat: t.lat, lon: t.lon, region: t.region, ...(t.marine ? { marine: t.marine } : {}) };
  }
  return sites;
}

export const sitesSignature = sites =>
  Object.entries(sites).map(([id, s]) => `${id}@${s.lat},${s.lon}${s.marine ? `~${s.marine.lat},${s.marine.lon}` : ''}`).join('|');
