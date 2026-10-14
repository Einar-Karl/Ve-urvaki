// Open-Meteo: forecast (best-match model), marine waves, ERA5 archive for history, plus one connector
// per individual weather model (ECMWF IFS, DWD ICON, NOAA GFS by default; OPENMETEO_MODELS to change,
// empty to disable). Each model is its own source, so the gap between models becomes the forecast
// uncertainty. Free tier is non-commercial only: for a commercial product set OPENMETEO_API_KEY
// (switches to the paid "customer-" hosts and appends &apikey=).
import { getJson } from '../lib/http.js';
import { REGIONS } from '../lib/regions.js';
import { round } from '../lib/time.js';

const KEY = process.env.OPENMETEO_API_KEY;
const host = sub => `https://${KEY ? 'customer-' : ''}${sub}open-meteo.com`;
const withKey = q => { if (KEY) q.set('apikey', KEY); return q; };
const asList = j => (Array.isArray(j) ? j : [j]);
const keyOf = t => t.slice(0, 13); // "2026-10-07T14:00" -> "2026-10-07T14" (timezone=GMT)

// `model` set: look for "<var>_<model>" first (multi-model responses are suffixed), then plain "<var>".
export function toRegionMap(ids, list, cols, model) {
  const out = {};
  ids.forEach((id, i) => {
    const h = list[i] && list[i].hourly;
    if (!h || !h.time) return;
    out[id] = {};
    h.time.forEach((t, k) => {
      const row = {};
      for (const [dst, src] of Object.entries(cols)) {
        const arr = (model && h[`${src}_${model}`]) || h[src];
        row[dst] = round(arr && arr[k]);
      }
      out[id][keyOf(t)] = row;
    });
  });
  return out;
}

const FC_COLS = { g: 'wind_gusts_10m', w: 'wind_speed_10m', dir: 'wind_direction_10m', p: 'precipitation', c: 'cloud_cover', t: 'temperature_2m' };
const HOURLY = 'temperature_2m,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m';

async function forecastFor(sites, model) {
  const ids = Object.keys(sites);
  const q = withKey(new URLSearchParams({
    latitude: ids.map(i => sites[i].lat).join(','), longitude: ids.map(i => sites[i].lon).join(','),
    hourly: HOURLY, wind_speed_unit: 'ms', timezone: 'GMT', forecast_days: '4', ...(model ? { models: model } : {}),
  }));
  return toRegionMap(ids, asList(await getJson(`${host('api.')}/v1/forecast?${q}`, { timeout: 15000 })), FC_COLS, model);
}

const primary = {
  id: 'openmeteo',
  label: 'Open-Meteo',
  kinds: ['forecast', 'marine', 'history'],
  license: 'CC BY 4.0 · free for non-commercial use; commercial use needs a subscription',
  attribution: 'Weather data by Open-Meteo.com',
  configured: () => true,

  forecast: ({ sites = REGIONS } = {}) => forecastFor(sites),

  async marine({ sites = REGIONS } = {}) {
    const ids = Object.keys(sites).filter(i => sites[i].marine);
    if (!ids.length) return {};
    const q = withKey(new URLSearchParams({
      latitude: ids.map(i => sites[i].marine.lat).join(','), longitude: ids.map(i => sites[i].marine.lon).join(','),
      hourly: 'wave_height', timezone: 'GMT', forecast_days: '4',
    }));
    const j = await getJson(`${host('marine-api.')}/v1/marine?${q}`);
    return toRegionMap(ids, asList(j), { s: 'wave_height' });
  },

  // ERA5 reanalysis, ~5 days behind real time. `end` = last full day to request (YYYY-MM-DD).
  async history({ start, end, sites = REGIONS }) {
    const ids = Object.keys(sites);
    const q = withKey(new URLSearchParams({
      latitude: ids.map(i => sites[i].lat).join(','), longitude: ids.map(i => sites[i].lon).join(','),
      start_date: start, end_date: end, hourly: 'wind_gusts_10m,precipitation', wind_speed_unit: 'ms', timezone: 'GMT',
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

const MODEL_LABELS = {
  ecmwf_ifs025: 'ECMWF IFS', icon_seamless: 'DWD ICON', gfs_seamless: 'NOAA GFS', ukmo_seamless: 'UK Met Office',
  meteofrance_seamless: 'Météo-France', gem_seamless: 'Environment Canada GEM', jma_seamless: 'JMA',
};

export const modelConnector = model => ({
  id: `openmeteo-${model}`,
  label: `${MODEL_LABELS[model] || model} (via Open-Meteo)`,
  kinds: ['forecast'],
  license: primary.license,
  attribution: primary.attribution,
  configured: () => true,
  forecast: ({ sites = REGIONS } = {}) => forecastFor(sites, model),
  async ping() {
    const q = new URLSearchParams({ latitude: '64.1', longitude: '-21.9', hourly: 'wind_gusts_10m', forecast_days: '1', models: model });
    const j = await getJson(`${host('api.')}/v1/forecast?${withKey(q)}`);
    const arr = j.hourly[`wind_gusts_10m_${model}`] || j.hourly.wind_gusts_10m || [];
    return `${arr.filter(v => v != null).length} gust values`;
  },
});

const models = (process.env.OPENMETEO_MODELS ?? 'ecmwf_ifs025,icon_seamless,gfs_seamless').split(',').map(s => s.trim()).filter(Boolean);
export default [primary, ...models.map(modelConnector)];
