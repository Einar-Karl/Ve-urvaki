// Risk watcher: re-evaluates upcoming departures and emits webhooks when something an integrator cares about
// changes: the status (go / change / cancel), the cancel probability by ≥ 15 points, or an access road closing.
// Runs every 10 minutes in the Node/Docker server; on Vercel (no timers) it runs opportunistically on requests.
import { col } from '../lib/store.js';
import { upcomingDepartures } from './departures.js';
import { emit } from './webhooks.js';

const state = () => col('risk_state');
let last = 0, running = false;

export async function checkRisk({ list } = {}) {
  if (running) return { changed: 0 };
  running = true;
  try {
    const deps = list || (await upcomingDepartures({ days: 3 })).departures;
    let changed = 0;
    for (const d of deps) {
      if (d.cancel == null) continue;
      const id = `${d.tourId}|${d.departure}`, prev = state().get(id);
      const road = d.road && d.road.length ? d.road : null;
      const payload = { tourId: d.tourId, tourName: d.tourName, departure: d.departure, status: d.status, cancelProbability: Math.round(d.cancel * 1000) / 1000, decideBy: d.deadline, road, reason: d.reason, bookedPax: d.bookedPax, guests: d.guests };
      if (prev && (prev.status !== d.status || Math.abs(prev.cancel - d.cancel) >= 0.15)) { emit('departure.risk_changed', { ...payload, previous: { status: prev.status, cancelProbability: prev.cancel } }); changed++; }
      if (road && !(prev && prev.road)) { emit('departure.road_blocked', payload); changed++; }
      state().put({ id, status: d.status, cancel: Math.round(d.cancel * 1000) / 1000, road: !!road, at: new Date().toISOString() });
    }
    last = Date.now();
    return { changed, checked: deps.length };
  } finally { running = false; }
}
export const maybeCheck = (everyMs = 10 * 60e3) => { if (Date.now() - last > everyMs) checkRisk().catch(() => {}); };
export function scheduleWatcher() { setTimeout(() => checkRisk().catch(() => {}), 15e3).unref(); setInterval(() => checkRisk().catch(() => {}), 10 * 60e3).unref(); }
