// Learns per-tour cancellation thresholds from real decisions.
//
// For each tour we fit  P(cancel) = sigmoid(a * gust + b)  on [forecast max gust during the trip,
// was it cancelled]. The dashboard's risk model uses a ramp [lo, hi] per factor, where lo is "risk
// starts" and hi is "historic cancel point", so we publish lo = gust at P=10% and hi = gust at P=90%.
// Nothing is overridden until a tour has enough decisions of BOTH kinds; until then defaults stay.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConnectors, withKind } from '../registry.js';

const MODEL_FILE = () => process.env.MODEL_FILE || fileURLToPath(new URL('../../config/thresholds.json', import.meta.url));
const sigmoid = z => 1 / (1 + Math.exp(-z));

// Newton-Raphson logistic regression with a small ridge on the slope (keeps separable data finite).
export function fitLogistic(xs, ys, { l2 = 0.05, iters = 60 } = {}) {
  const n = xs.length;
  const mu = xs.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / n) || 1;
  const z = xs.map(x => (x - mu) / sd);
  let a = 0, b = Math.log((ys.reduce((s, y) => s + y, 0) + 0.5) / (n - ys.reduce((s, y) => s + y, 0) + 0.5));
  for (let it = 0; it < iters; it++) {
    let ga = -l2 * a, gb = 0, haa = -l2, hab = 0, hbb = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(a * z[i] + b), w = p * (1 - p), r = ys[i] - p;
      ga += r * z[i]; gb += r; haa -= w * z[i] * z[i]; hab -= w * z[i]; hbb -= w;
    }
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) break;
    const da = (hbb * ga - hab * gb) / det, db = (-hab * ga + haa * gb) / det;
    a -= da; b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  const ar = a / sd;
  return { a: ar, b: b - a * mu / sd };
}
export const xAt = ({ a, b }, p) => (Math.log(p / (1 - p)) - b) / a;

// samples: [{ tourId, g (forecast max gust during the trip), cancelled: boolean }]
export function fitThresholds(samples, { minN = 30, minClass = 8 } = {}) {
  const byTour = {};
  for (const s of samples) if (Number.isFinite(s.g)) (byTour[s.tourId] ||= []).push(s);
  const out = {};
  for (const [id, rows] of Object.entries(byTour)) {
    const k = rows.filter(r => r.cancelled).length, n = rows.length;
    const base = { n, cancelled: k, ran: n - k };
    if (n < minN || k < minClass || n - k < minClass) {
      out[id] = { ...base, status: 'insufficient', reason: `need ≥${minN} decisions with ≥${minClass} cancelled and ≥${minClass} ran` };
      continue;
    }
    const fit = fitLogistic(rows.map(r => r.g), rows.map(r => (r.cancelled ? 1 : 0)));
    if (!(fit.a > 0)) { out[id] = { ...base, status: 'insufficient', reason: 'no positive relationship between gust and cancellation' }; continue; }
    let lo = xAt(fit, 0.10), hi = xAt(fit, 0.90);
    lo = Math.max(3, lo); hi = Math.min(60, Math.max(hi, lo + 3));
    out[id] = { ...base, status: 'learned', g: [Math.round(lo * 10) / 10, Math.round(hi * 10) / 10], p50: Math.round(xAt(fit, 0.5) * 10) / 10 };
  }
  return out;
}

export function loadModel() {
  const f = MODEL_FILE();
  if (!existsSync(f)) return { trainedAt: null, tours: {} };
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return { trainedAt: null, tours: {} }; }
}

// Max gust during [departure, departure+duration] from hourly archive data ({ 'YYYY-MM-DDTHH': { g } }).
export function maxGustInWindow(byHour, departureIso, durationHours) {
  const t0 = new Date(departureIso).getTime();
  let m = null;
  for (let i = 0; i <= durationHours; i++) {
    const g = byHour[new Date(t0 + i * 3600e3).toISOString().slice(0, 13)]?.g;
    if (g != null && (m == null || g > m)) m = g;
  }
  return m;
}

// Turn outcome records into training samples. Records pushed from the dashboard carry the forecast that
// was on screen at decision time (snapshot.g); older imported records are enriched from ERA5 archive.
export async function buildSamples(records, tours, { changedAsCancel = false, now = new Date() } = {}) {
  const tourById = new Map(tours.map(t => [String(t.id), t]));
  const samples = [], need = [];
  for (const r of records) {
    if (r.mode === 'demo') continue;                                  // never train on synthetic data
    const cancelled = r.outcome === 'cancelled' || (changedAsCancel && r.outcome === 'changed');
    if (r.outcome === 'changed' && !changedAsCancel) continue;
    const id = String(r.tourId ?? r.tour);
    if (!tourById.has(id)) continue;
    const g = r.snapshot && Number.isFinite(r.snapshot.g) ? r.snapshot.g : null;
    if (g != null) samples.push({ tourId: id, g, cancelled, source: 'snapshot' });
    else need.push({ id, departure: r.departure, cancelled });
  }
  const cutoff = now.getTime() - 6 * 86400e3;                           // archive lags a few days
  const eligible = need.filter(n => Date.parse(n.departure) < cutoff);
  const skipped = need.length - eligible.length;
  let enriched = 0;
  if (eligible.length) {
    const hist = withKind(await loadConnectors(), 'history')[0];
    if (!hist) throw new Error('no history connector to enrich imported outcomes');
    const ids = [...new Set(eligible.map(e => e.id))];
    for (const id of ids) {                                             // one archive request per tour
      const t = tourById.get(id), mine = eligible.filter(e => e.id === id);
      const days = mine.map(e => e.departure.slice(0, 10)).sort();
      const data = await hist.history({ start: days[0], end: days[days.length - 1], sites: { [id]: { lat: t.lat, lon: t.lon } } });
      for (const e of mine) {
        const g = maxGustInWindow(data[id] || {}, e.departure, t.durationHours || 3);
        if (g != null) { samples.push({ tourId: id, g, cancelled: e.cancelled, source: 'archive' }); enriched++; }
      }
    }
  }
  return { samples, enriched, skipped };
}

// How well did the model's cancel probability (recorded at decision time) match what the duty
// managers actually decided? Only live-mode records with a snapshot count. "changed" is excluded.
export function evaluate(records, { threshold = 0.5 } = {}) {
  const rows = records.filter(r => r.mode === 'live' && r.snapshot && Number.isFinite(r.snapshot.cancelProb) && (r.outcome === 'ran' || r.outcome === 'cancelled'));
  const buckets = [0, 0.2, 0.4, 0.6, 0.8].map(lo => ({ from: lo, to: lo + 0.2, n: 0, cancelled: 0 }));
  let agree = 0, missed = 0, falseAlarm = 0;
  for (const r of rows) {
    const p = r.snapshot.cancelProb, c = r.outcome === 'cancelled';
    const b = buckets[Math.min(4, Math.floor(p / 0.2))]; b.n++; if (c) b.cancelled++;
    if ((p >= threshold) === c) agree++; else if (c) missed++; else falseAlarm++;
  }
  return { n: rows.length, agreement: rows.length ? agree / rows.length : null, missedCancellations: missed, falseAlarms: falseAlarm, calibration: buckets.map(b => ({ ...b, observed: b.n ? b.cancelled / b.n : null })) };
}
