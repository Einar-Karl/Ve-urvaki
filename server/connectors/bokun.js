// Bókun (booking system) — reads departures with booked/remaining seats per tour, so the dashboard
// shows Arctic Adventures' real guest counts instead of demo numbers.
//
// Auth (per Bókun's developer docs, bokun.dev "Configuring the platform for API usage and authentication"):
//   X-Bokun-Date       UTC "yyyy-MM-dd HH:mm:ss"
//   X-Bokun-AccessKey  the API key's access key
//   X-Bokun-Signature  base64( HMAC-SHA1( secretKey, date + accessKey + METHOD + pathWithQuery ) )
//
// NOT VERIFIED from the build sandbox: the base URL (BOKUN_BASE, default https://api.bokun.io), the
// availability path, and the response field names. Parsing below is alias-tolerant; run
// `npm run check` once real keys are set and compare the printed sample with docs/SETUP-ARCTIC.md.
import crypto from 'node:crypto';
import { getJson } from '../lib/http.js';
import { num } from '../lib/time.js';

const BASE = () => process.env.BOKUN_BASE || 'https://api.bokun.io';
const ACCESS = () => process.env.BOKUN_ACCESS_KEY;
const SECRET = () => process.env.BOKUN_SECRET_KEY;

export const bokunDate = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', ' ');
export const sign = ({ date, accessKey, secret, method, path }) =>
  crypto.createHmac('sha1', secret).update(`${date}${accessKey}${method.toUpperCase()}${path}`).digest('base64');

function headersFor(method, path, now = new Date()) {
  const date = bokunDate(now);
  return {
    'X-Bokun-Date': date, 'X-Bokun-AccessKey': ACCESS(),
    'X-Bokun-Signature': sign({ date, accessKey: ACCESS(), secret: SECRET(), method, path }),
  };
}
const call = path => getJson(`${BASE()}${path}`, { timeout: 15000, headers: headersFor('GET', path) });

const first = (o, names) => { for (const n of names) if (o[n] != null) return o[n]; };

// One availability entry -> one departure. `date` may be epoch ms (Bókun) or "YYYY-MM-DD".
export function parseAvailabilities(list, tour) {
  const rows = Array.isArray(list) ? list : (list.availabilities || list.data || []);
  const out = [];
  for (const a of rows) {
    const d = first(a, ['date', 'localizedDate', 'day']);
    const day = typeof d === 'number' ? new Date(d).toISOString().slice(0, 10) : String(d || '').slice(0, 10);
    const time = String(first(a, ['startTime', 'time']) || (tour.departures && tour.departures[0]) || '00:00').slice(0, 5);
    if (!/^\d{4}-\d\d-\d\d$/.test(day) || !/^\d\d:\d\d$/.test(time)) continue;
    const pax = num(first(a, ['bookedParticipants', 'booked', 'participants']));
    if (pax == null) continue;
    const left = num(first(a, ['availabilityCount', 'availability', 'remaining']));
    const unlimited = !!first(a, ['unlimitedAvailability']);
    out.push({
      tourId: tour.id, departure: `${day}T${time}:00Z`, pax,
      capacity: unlimited || left == null ? (tour.capacity ?? null) : pax + left,
      soldOut: !!first(a, ['soldOut']) || (left === 0 && !unlimited),
    });
  }
  return out;
}

export default {
  id: 'bokun',
  label: 'Bókun · bókanir',
  kinds: ['bookings'],
  license: 'Bókun API terms apply (bokun.io/api-terms)',
  attribution: 'Bookings: Bókun',
  configured: () => !!(ACCESS() && SECRET()),

  async bookings({ tours, start, end }) {
    const departures = [], errors = [];
    for (const t of tours.filter(t => t.bokunProductId)) {
      try {
        const list = await call(`/activity.json/${encodeURIComponent(t.bokunProductId)}/availabilities?start=${start}&end=${end}`);
        departures.push(...parseAvailabilities(list, t));
      } catch (e) { errors.push({ tourId: t.id, error: e.message }); }
    }
    return { departures, errors };
  },

  async ping() {
    if (!this.configured()) throw Object.assign(new Error('BOKUN_ACCESS_KEY / BOKUN_SECRET_KEY not set'), { unconfigured: true });
    const { readTours } = await import('../lib/sites.js');
    const t = readTours().tours.find(t => t.bokunProductId);
    if (!t) throw Object.assign(new Error('keys set, but no tour in config/tours.json has a bokunProductId'), { unconfigured: true });
    const day = new Date().toISOString().slice(0, 10);
    const list = await call(`/activity.json/${encodeURIComponent(t.bokunProductId)}/availabilities?start=${day}&end=${day}`);
    const rows = Array.isArray(list) ? list : (list.availabilities || list.data || []);
    return `${rows.length} availability entries for "${t.name}"; sample keys: ${rows[0] ? Object.keys(rows[0]).slice(0, 8).join(', ') : '–'}`;
  },
};
