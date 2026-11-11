// A coarse forecast grid over Iceland for the map's wind layer: one Open-Meteo multi-location request
// (best-match model), cached 30 minutes. ~100 points × 72 h × 3 values keeps the payload small.
import { memo } from '../lib/cache.js';
import { getJson } from '../lib/http.js';
import { round, utcMidnight, hourKeys } from '../lib/time.js';

export const GRID = { latMin: 63.4, latMax: 66.6, lonMin: -24.5, lonMax: -13.5, dLat: 0.4, dLon: 1.0 };
export function gridPoints(g = GRID) {
  const pts = [];
  for (let lat = g.latMin; lat <= g.latMax + 1e-9; lat += g.dLat) for (let lon = g.lonMin; lon <= g.lonMax + 1e-9; lon += g.dLon) pts.push([round(lat, 2), round(lon, 2)]);
  return pts;
}

export async function getGrid({ now = new Date(), hours = 72, mode = process.env.DATA_MODE || 'auto' } = {}) {
  if (mode === 'demo') return { mode: 'demo', points: [], hours: 0 };
  const start = utcMidnight(now), keys = hourKeys(start, hours), pts = gridPoints();
  try {
    return await memo(`grid:${keys[0]}:${hours}`, 30 * 60e3, async () => {
      const key = process.env.OPENMETEO_API_KEY;
      const q = new URLSearchParams({ latitude: pts.map(p => p[0]).join(','), longitude: pts.map(p => p[1]).join(','), hourly: 'wind_gusts_10m,wind_speed_10m,wind_direction_10m', wind_speed_unit: 'ms', timezone: 'GMT', forecast_days: String(Math.ceil(hours / 24) + 1), ...(key ? { apikey: key } : {}) });
      const j = await getJson(`https://${key ? 'customer-' : ''}api.open-meteo.com/v1/forecast?${q}`, { timeout: 20000 });
      const list = Array.isArray(j) ? j : [j];
      const points = list.map((loc, i) => {
        const h = loc.hourly || {}, idx = new Map((h.time || []).map((t, k) => [t.slice(0, 13), k]));
        const pick = (arr, k) => (idx.has(k) && arr ? round(arr[idx.get(k)]) : null);
        return { lat: pts[i][0], lon: pts[i][1], g: keys.map(k => pick(h.wind_gusts_10m, k)), w: keys.map(k => pick(h.wind_speed_10m, k)), dir: keys.map(k => pick(h.wind_direction_10m, k)) };
      });
      return { mode: 'live', start: start.toISOString(), hours, source: 'openmeteo', attribution: 'Weather data by Open-Meteo.com', points };
    });
  } catch (e) {
    return { mode: 'unavailable', error: e.message, points: [], hours: 0 };
  }
}
