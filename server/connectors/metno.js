// MET Norway Locationforecast 2.0 (global, includes Iceland). Second opinion next to Open-Meteo;
// the spread between the two feeds the forecast-uncertainty figure.
// Terms: CC BY 4.0 + NLOD, identifying User-Agent required (see lib/http.js), credit must be shown.
import { getJson } from '../lib/http.js';
import { REGIONS } from '../lib/regions.js';
import { hourKey, round } from '../lib/time.js';

const URL_BASE = process.env.METNO_BASE || 'https://api.met.no/weatherapi/locationforecast/2.0';
const fix4 = x => Math.round(x * 1e4) / 1e4; // API rejects more than 4 decimals

// The series is hourly for ~2.5 days, then 3-6 hourly. Hold each value until the next entry.
export function parseTimeseries(ts) {
  const out = {};
  ts.forEach((e, i) => {
    const d = e.data.instant.details;
    const next = e.data.next_1_hours || e.data.next_6_hours || e.data.next_12_hours;
    const span = e.data.next_1_hours ? 1 : e.data.next_6_hours ? 6 : 12;
    const precip = next && next.details && next.details.precipitation_amount != null ? next.details.precipitation_amount / span : null;
    const t0 = new Date(e.time).getTime();
    const t1 = i + 1 < ts.length ? new Date(ts[i + 1].time).getTime() : t0 + 3600e3;
    for (let t = t0; t < t1; t += 3600e3) {
      out[hourKey(new Date(t))] = {
        g: round(d.wind_speed_of_gust), w: round(d.wind_speed), dir: round(d.wind_from_direction, 0),
        p: round(precip), c: round(d.cloud_area_fraction, 0), t: round(d.air_temperature),
      };
    }
  });
  return out;
}

async function one(r) {
  const j = await getJson(`${URL_BASE}/complete?lat=${fix4(r.lat)}&lon=${fix4(r.lon)}`);
  return parseTimeseries(j.properties.timeseries);
}

export default {
  id: 'metno',
  label: 'MET Norway',
  kinds: ['forecast'],
  license: 'CC BY 4.0 + NLOD · User-Agent required',
  attribution: 'Data: © MET Norway, CC BY 4.0',
  configured: () => true,

  async forecast() {
    const out = {};
    // Sequential on purpose: MET asks clients to be gentle, and results are cached upstream.
    for (const [id, r] of Object.entries(REGIONS)) out[id] = await one(r);
    return out;
  },

  async ping() {
    const j = await getJson(`${URL_BASE}/compact?lat=64.1&lon=-21.9`);
    return `${j.properties.timeseries.length} time steps`;
  },
};
