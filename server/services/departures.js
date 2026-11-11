// Upcoming departures of the configured tours with risk, guests and cases. Used by the admin Notifications tab,
// the public API (GET /api/v1/departures) and the risk watcher that emits webhooks.
import { readTours } from '../lib/sites.js';
import { getBookings } from './bookings.js';
import { getRiskContext } from './riskctx.js';
import { listGuests } from './guests.js';
import * as cases from './cases.js';

const HOUR = 3600e3;
async function riskCtx() { try { return await getRiskContext(); } catch { return null; } }

export async function upcomingDepartures({ days = 3 } = {}) {
  const ctx = await riskCtx(), { tours: list } = readTours();
  const now = Date.now(), out = [];
  const b = await getBookings({ tours: list, days: 4 });
  const pax = new Map(b.departures.map(d => [`${d.tourId}|${new Date(d.departure).toISOString()}`, d.pax]));
  const day0 = new Date(now); day0.setUTCHours(0, 0, 0, 0);
  for (const t of list) for (let d = 0; d < days; d++) for (const hhmm of t.departures || []) {
    const iso = new Date(day0.getTime() + d * 86400e3 + (parseInt(hhmm, 10) * 60 + parseInt(hhmm.split(':')[1] || 0, 10)) * 60e3).toISOString();
    if (Date.parse(iso) < now - HOUR) continue;
    const R = ctx ? ctx.riskAt(t.id, iso) : null;
    const gs = listGuests({ tourId: t.id, departure: iso });
    const cs = cases.listCases({ tourId: t.id, departure: iso });
    out.push({ tourId: t.id, tourName: t.name, departure: iso, cancel: R ? R.cancel : null, status: R ? R.status : null, road: R && R.road ? R.road : null,
      reason: R ? cases.reasonFrom(R, ctx.factors(t.id)) : null, bookedPax: pax.get(`${t.id}|${iso}`) ?? null,
      guests: gs.length, guestPax: gs.reduce((s, g) => s + g.pax, 0), reachable: gs.filter(g => g.email || g.phone).length,
      cases: cs.length, casesSent: cs.filter(c => c.state !== 'prepared').length, deadline: cases.decisionDeadline(iso) });
  }
  return { forecastMode: ctx ? ctx.forecastMode : 'unavailable', departures: out.sort((a, b) => (b.cancel ?? -1) - (a.cancel ?? -1) || a.departure.localeCompare(b.departure)) };
}

