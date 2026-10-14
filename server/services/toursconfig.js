// Read/write config/tours.json from the admin page, the partner API and CSV imports.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tourFile, validateTours, TOUR_TYPES } from '../lib/sites.js';
import { num } from '../lib/csv.js';

export const readRaw = () => JSON.parse(readFileSync(tourFile(), 'utf8'));

function writeAll(tours) {
  const f = tourFile();
  writeFileSync(f + '.tmp', JSON.stringify({ demo: false, tours }, null, 2) + '\n');
  renameSync(f + '.tmp', f);
}

// Coerce JSON/CSV/form input into the shape the app expects.
export function normalizeTour(t) {
  const out = { ...t };
  if (typeof out.id === 'string' && /^\d+$/.test(out.id)) out.id = +out.id;
  for (const k of ['lat', 'lon', 'durationHours', 'capacity', 'priceISK']) if (out[k] !== undefined && out[k] !== '') out[k] = num(out[k]) ?? out[k];
  if (typeof out.departures === 'string') out.departures = out.departures.split(/[|,;]/).map(s => s.trim()).filter(Boolean);
  if (typeof out.roads === 'string') out.roads = out.roads.split('|').map(s => s.trim()).filter(Boolean);
  if (out.bokunProductId === '') out.bokunProductId = null;
  if (out.marine && typeof out.marine === 'object') out.marine = { lat: num(out.marine.lat), lon: num(out.marine.lon) };
  return out;
}

// Problems that must block a save (the bokunProductId hint is only advice).
export const errorsFor = tours => validateTours(tours).filter(w => !/bokunProductId/.test(w));

export function saveAll(list) {
  const tours = list.map(normalizeTour);
  const errors = errorsFor(tours);
  if (errors.length) return { ok: false, errors };
  writeAll(tours);
  return { ok: true, count: tours.length, warnings: validateTours(tours) };
}

export function upsert(list) {
  const cur = readRaw().tours || [];
  const byId = new Map(cur.map(t => [String(t.id), t]));
  for (const t of list.map(normalizeTour)) byId.set(String(t.id), { ...byId.get(String(t.id)), ...t });
  return saveAll([...byId.values()]);
}

export function remove(id) {
  const cur = readRaw().tours || [];
  const next = cur.filter(t => String(t.id) !== String(id));
  if (next.length === cur.length) return { ok: false, errors: ['no such tour'] };
  return saveAll(next);
}

// CSV columns: id;name;type;lat;lon;departures;durationHours;capacity;priceISK;bokunProductId;region;roads;marineLat;marineLon
// departures "09:00|13:00", roads "Hringvegur|Þórsmerkurvegur"
export function fromCsvRows(rows) {
  const tours = [], errors = [];
  rows.forEach((r, i) => {
    const t = normalizeTour({ id: r.id, name: r.name, type: r.type, lat: r.lat, lon: r.lon, departures: r.departures, durationHours: r.durationHours, capacity: r.capacity, priceISK: r.priceISK, bokunProductId: r.bokunProductId ?? '', region: r.region || undefined, roads: r.roads || undefined, ...(r.marineLat ? { marine: { lat: r.marineLat, lon: r.marineLon } } : {}) });
    const e = errorsFor([t]);
    if (e.length) errors.push({ row: i + 1, errors: e }); else tours.push(t);
  });
  return { tours, errors };
}
export { TOUR_TYPES };
