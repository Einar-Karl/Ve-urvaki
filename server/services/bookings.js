// Booking numbers per departure. Priority:
//   1. live from Bókun (when BOKUN_* keys are set)
//   2. snapshots pushed through POST /api/ingest/bookings (CSV export, Zapier, any system)
//   3. none -> the dashboard falls back to labelled demo numbers
import { memo } from '../lib/cache.js';
import { utcMidnight } from '../lib/time.js';
import { loadConnectors, withKind } from '../registry.js';
import { read } from './ingest.js';

const ymd = d => d.toISOString().slice(0, 10);

export function latestSnapshots(rows, fromMs, toMs) {
  const byKey = new Map();
  for (const r of rows) {                       // rows are in arrival order: later wins
    const t = Date.parse(r.departure);
    if (!(t >= fromMs && t < toMs)) continue;
    byKey.set(`${r.tourId ?? r.tour}|${new Date(t).toISOString()}`, { tourId: r.tourId ?? r.tour, departure: new Date(t).toISOString(), pax: r.pax, capacity: r.capacity ?? null, soldOut: !!r.soldOut });
  }
  return [...byKey.values()];
}

export async function getBookings({ tours, now = new Date(), days = 4 }) {
  const start = utcMidnight(now), end = new Date(start.getTime() + (days - 1) * 86400e3);
  const notes = [];
  const c = withKind(await loadConnectors(), 'bookings').find(c => c.configured());
  if (c) {
    try {
      const r = await memo(`bookings:${c.id}:${days}:${Math.floor(now.getTime() / 120e3)}`, 120e3, async () => {
        const out = await c.bookings({ tours, start: ymd(start), end: ymd(end) });
        if (!out.departures.length && out.errors.length) throw new Error(out.errors.map(e => `tour ${e.tourId}: ${e.error}`).join('; '));
        return out;
      });
      return { mode: 'live', source: c.id, attribution: c.attribution, fetchedAt: now.toISOString(), departures: r.departures, errors: r.errors };
    } catch (e) { notes.push(`${c.id}: ${e.message}`); }
  }
  const snaps = latestSnapshots(read('bookings', 5000), start.getTime(), end.getTime() + 86400e3);
  if (snaps.length) return { mode: 'ingested', source: 'ingest', fetchedAt: now.toISOString(), departures: snaps, errors: [], notes };
  return { mode: 'none', departures: [], errors: [], notes };
}
