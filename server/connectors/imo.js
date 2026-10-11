// Icelandic Met Office (Veðurstofa Íslands) — latest hourly observations from automatic stations,
// including stations run by Vegagerðin and Landsvirkjun. Used to sanity-check forecasts against
// what the nearest station is actually measuring right now.
//
// STATUS: the endpoint URL is documented by IMO's open API; the JSON field names below are matched
// case-insensitively against aliases because they could not be verified from the build sandbox.
// Run `npm run check` on a networked machine: it prints the raw field names and the mapping.
import { getJson } from '../lib/http.js';
import { haversineKm, REGIONS } from '../lib/regions.js';
import { num, round } from '../lib/time.js';
import { readFileSync } from 'node:fs';

const URL_OBS = process.env.IMO_OBS_URL || 'https://api.vedur.is/weather/observations/aws/hour/latest';
const ALIAS = {
  id: ['station_id', 'stationid', 'station', 'stod', 'id'], name: ['station_name', 'name', 'nafn'],
  lat: ['lat', 'latitude'], lon: ['lon', 'lng', 'longitude'],
  gust: ['wind_gust', 'windgust', 'gust', 'fg', 'wind_speed_of_gust', 'fx'],
  wind: ['wind_speed', 'windspeed', 'f', 'ff'], dir: ['wind_direction', 'winddirection', 'd', 'dd'],
  temp: ['temperature', 'temp', 't'], precip: ['precipitation', 'precip', 'r', 'rain'],
  time: ['time', 'timestamp', 'observation_time', 'datetime', 'date'],
};
const pick = (o, names) => {
  const keys = Object.keys(o);
  for (const n of names) { const k = keys.find(k => k.toLowerCase() === n); if (k && o[k] != null) return o[k]; }
};

export function normalizeRows(j) {
  const rows = Array.isArray(j) ? j : (j.data || j.stations || j.observations || Object.values(j));
  return rows.filter(r => r && typeof r === 'object').map(r => {
    const loc = r.location || r.coordinates || r.position || {};
    return {
      id: String(pick(r, ALIAS.id) ?? ''), name: pick(r, ALIAS.name) || null,
      lat: num(pick(r, ALIAS.lat) ?? pick(loc, ALIAS.lat)), lon: num(pick(r, ALIAS.lon) ?? pick(loc, ALIAS.lon)),
      g: num(pick(r, ALIAS.gust)), w: num(pick(r, ALIAS.wind)), dir: num(pick(r, ALIAS.dir)),
      t: num(pick(r, ALIAS.temp)), p: num(pick(r, ALIAS.precip)), time: pick(r, ALIAS.time) || null,
    };
  });
}

// config/stations.json: { "rvk": "1", "south": ["5944"] } pins stations to regions when the feed
// carries no coordinates (or you prefer a specific road/glacier station).
function pinned() { try { return JSON.parse(readFileSync(new URL('../../config/stations.json', import.meta.url), 'utf8')); } catch { return {}; } }

export function matchRegions(rows, pins = pinned(), maxKm = 40, sites = REGIONS) {
  const out = {};
  for (const [id, r] of Object.entries(sites)) {
    const want = [].concat(pins[id] || []).map(String);
    let hit = rows.find(s => want.includes(s.id));
    let km = null;
    if (!hit) {
      const cand = rows.filter(s => s.lat != null && s.lon != null).map(s => ({ s, km: haversineKm(r, s) })).filter(c => c.km <= maxKm).sort((a, b) => a.km - b.km)[0];
      if (cand) { hit = cand.s; km = Math.round(cand.km); }
    }
    if (hit) out[id] = { station: hit.id, name: hit.name, km, g: round(hit.g), w: round(hit.w), dir: hit.dir, t: round(hit.t), p: round(hit.p), time: hit.time };
  }
  return out;
}

export default {
  id: 'imo',
  label: 'Veðurstofa Íslands · mælingar',
  kinds: ['observation'],
  license: 'IMO open API (check terms at api.vedur.is)',
  attribution: 'Observations: Icelandic Met Office',
  configured: () => true,
  async observation({ sites = REGIONS } = {}) {
    const rows = normalizeRows(await getJson(URL_OBS));
    return { regions: matchRegions(rows, pinned(), 40, sites), stations: rows.length, sample: rows[0] || null };
  },
  async ping() {
    const rows = normalizeRows(await getJson(URL_OBS));
    const withGust = rows.filter(r => r.g != null).length;
    return `${rows.length} stations, ${withGust} with gust, ${rows.filter(r => r.lat != null).length} with coordinates`;
  },
};
