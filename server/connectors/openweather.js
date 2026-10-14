// OpenWeatherMap One Call 3.0 — optional extra forecast source (needs OPENWEATHER_API_KEY and a
// One Call 3.0 subscription; the free allowance is 1,000 calls/day). Hourly data covers 48 h, so
// it adds a vote for the first two days only; later hours use the other sources.
// Calls are cached for 60 minutes and de-duplicated per ~1 km cell to stay inside the allowance.
import { getJson } from '../lib/http.js';
import { memo } from '../lib/cache.js';
import { REGIONS } from '../lib/regions.js';
import { hourKey, round } from '../lib/time.js';

const KEY = () => process.env.OPENWEATHER_API_KEY;
const BASE = () => process.env.OPENWEATHER_BASE || 'https://api.openweathermap.org/data/3.0/onecall';

export function parseOneCall(j) {
  const out = {};
  for (const h of j.hourly || []) {
    out[hourKey(new Date(h.dt * 1000))] = {
      g: round(h.wind_gust ?? h.wind_speed), w: round(h.wind_speed), dir: round(h.wind_deg, 0),
      p: round((h.rain && h.rain['1h'] || 0) + (h.snow && h.snow['1h'] || 0)), c: round(h.clouds, 0), t: round(h.temp),
    };
  }
  return out;
}
const call = (lat, lon) => memo(`owm:${lat.toFixed(2)},${lon.toFixed(2)}`, 60 * 60e3, async () =>
  parseOneCall(await getJson(`${BASE()}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&exclude=minutely,daily,alerts&units=metric&appid=${KEY()}`)));

export default {
  id: 'openweather',
  label: 'OpenWeatherMap',
  kinds: ['forecast'],
  license: 'OpenWeather terms; CC BY-SA 4.0 for open data, attribution required',
  attribution: 'Weather data: OpenWeather',
  configured: () => !!KEY(),
  async forecast({ sites = REGIONS } = {}) {
    const out = {};
    for (const [id, s] of Object.entries(sites)) out[id] = await call(s.lat, s.lon);
    return out;
  },
  async ping() {
    if (!KEY()) throw Object.assign(new Error('OPENWEATHER_API_KEY not set (optional source)'), { unconfigured: true });
    const r = await call(64.1, -21.9);
    return `${Object.keys(r).length} hourly values`;
  },
};
