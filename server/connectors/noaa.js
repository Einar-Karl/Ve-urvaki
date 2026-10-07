// NOAA SWPC planetary Kp index (observed + predicted, 3-hourly). Public domain.
// Only relevant to aurora tours; cloud cover (from the forecast connectors) is the other half.
import { getJson } from '../lib/http.js';
import { num } from '../lib/time.js';

const URL_KP = process.env.NOAA_KP_URL || 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';

// Handles both published shapes: array of objects, or array of arrays with a header row.
export function parseKp(j) {
  if (!Array.isArray(j) || !j.length) return [];
  let rows = j;
  if (Array.isArray(j[0])) {
    const head = j[0].map(x => String(x).toLowerCase());
    rows = j.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }
  return rows.map(r => {
    const t = r.time_tag || r.timetag;
    const kp = num(r.kp ?? r.Kp ?? r.kp_index);
    if (!t || kp == null) return null;
    return { t: new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t.replace(' ', 'T') + 'Z').toISOString(), kp, observed: r.observed || null };
  }).filter(Boolean);
}

export default {
  id: 'noaa',
  label: 'NOAA SWPC (Kp)',
  kinds: ['aurora'],
  license: 'Public domain (US Government)',
  attribution: 'Space weather: NOAA SWPC',
  configured: () => true,
  async aurora() { return parseKp(await getJson(URL_KP)); },
  async ping() { const r = parseKp(await getJson(URL_KP)); return `${r.length} Kp values`; },
};
