// Open-Meteo: forecast (best-match model), marine waves, and ERA5 archive for history.
// Free tier is non-commercial only. For a commercial product set OPENMETEO_API_KEY
// (switches to the paid "customer-" hosts and appends &apikey=).
import { getJson } from '../lib/http.js';
import { REGIONS } from '../lib/regions.js';
import { round } from '../lib/time.js';

const KEY = process.env.OPENMETEO_API_KEY;
const host = sub => `https://${KEY ? 'customer-' : ''}${sub}open-meteo.com`;
const withKey = q => { if (KEY) q.set('apikey', KEY); return q; };
const asList = j => (Array.isArray(j) ? j : [j]);
const keyOf = t => t.slice(0, 13); // "2026-10-07T14:00" -> "2026-10-07T14" (timezone=GMT)

function toRegionMap(ids, list, cols) {
  const out = {};
  ids.forEach((id, i) => {
    const h = list[i] && list[i].hourly;
    if (!h || !h.time) return;
    out[id] = {};
    h.time.forEach((t, k) => {
      const row = {};
      for (const [dst, src] of Object.entries(cols)) row[dst] = round(h[src] && h[src][k]);
      out[id][keyOf(t)] = row;
    });
  });
  return out;
}

export default {
  id: 'openmeteo',
  label: 'Open-Meteo',
  kinds: ['forecast', 'marine', 'history'],
  license: 'CC BY 4.0 · free for non-commercial use; commercial use needs a subscription',
  attribution: 'Weather data by Open-Meteo.com',
  configured: () => true,

  async forecast({ sites = REGIONS } = {}) {
    const ids = Object.keys(sites);
    const q = withKey(new URLSearchParams({
      latitude: ids.map(i => sites[i].lat).join(','),
      longitude: ids.map(i => sites[i].lon).join(','),
      hourly: 'temperature_2m,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
      wind_speed_unit: 'ms', timezone: 'GMT', forecast_days: '4',
    }));
    const j = await getJson(`${host('api.')}/v1/forecast?${q}`);
    return toRegionMap(ids, asList(j), { g: 'wind_gusts_10m', w: 'wind_speed_10m', dir: 'wind_direction_10m', p: 'precipitation', c: 'cloud_cover', t: 'temperature_2m' });
  },

  async marine({ sites = REGIONS } = {}) {
    const ids = Object.keys(sites).filter(i => sites[i].marine);
    if (!ids.length) return {};
    const q = withKey(new URLSearchParams({
      latitude: ids.map(i => sites[i].marine.lat).join(','),
      longitude: ids.map(i => sites[i].marine.lon).join(','),
      hourly: 'wave_height', timezone: 'GMT', forecast_days: '4',
    }));
    const j = await getJson(`${host('marine-api.')}/v1/marine?${q}`);
    return toRegionMap(ids, asList(j), { s: 'wave_height' });
  },

  // ERA5 reanalysis, ~5 days behind real time. `end` = last full day to request (YYYY-MM-DD).
  async history({ start, end, sites = REGIONS }) {
    const ids = Object.keys(sites);
    const q = withKey(new URLSearchParams({
      latitude: ids.map(i => sites[i].lat).join(','),
      longitude: ids.map(i => sites[i].lon).join(','),
      start_date: start, end_date: end,
      hourly: 'wind_gusts_10m,precipitation', wind_speed_unit: 'ms', timezone: 'GMT',
    }));
    const j = await getJson(`${host('archive-api.')}/v1/archive?${q}`, { timeout: 20000 });
    return toRegionMap(ids, asList(j), { g: 'wind_gusts_10m', p: 'precipitation' });
  },

  async ping() {
    const q = new URLSearchParams({ latitude: '64.1', longitude: '-21.9', hourly: 'wind_gusts_10m', forecast_days: '1' });
    const j = await getJson(`${host('api.')}/v1/forecast?${withKey(q)}`);
    return `${j.hourly.time.length} hourly values`;
  },
};
