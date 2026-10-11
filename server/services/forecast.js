// Fuses every forecast connector into one normalized hourly series per region:
//   { g gust m/s, w wind m/s, dir deg (from), p precip mm/h, c cloud %, t °C, s wave m, sp gust spread m/s }
// `sp` is the disagreement between sources (max - min gust). The risk model widens its
// uncertainty with it, so two models that disagree produce a less confident cancel call.
import { memo } from '../lib/cache.js';
import { hourKeys, utcMidnight, round } from '../lib/time.js';
import { loadConnectors, withKind } from '../registry.js';
import { demoForecast } from './demo.js';
import { REGIONS } from '../lib/regions.js';
import { sitesSignature } from '../lib/sites.js';

const HOURS = 96;
const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const vals = (rows, k) => rows.map(r => r && r[k]).filter(v => v != null);

export function fuse(keys, sources, marine, ids) {
  const regions = {};
  for (const id of ids) {
    const series = [];
    let last = null;
    for (const k of keys) {
      const rows = sources.map(s => s.data[id] && s.data[id][k]).filter(Boolean);
      let o;
      if (rows.length) {
        const gusts = vals(rows, 'g');
        // gust missing in a source -> fall back to 1.5x mean wind (same relation as the demo model)
        const g = gusts.length ? avg(gusts) : (avg(vals(rows, 'w')) ?? 0) * 1.5;
        o = {
          g: round(g), w: round(avg(vals(rows, 'w'))), dir: round(rows.find(r => r.dir != null)?.dir ?? last?.dir ?? 0, 0),
          p: round(avg(vals(rows, 'p')) ?? 0), c: round(avg(vals(rows, 'c')) ?? 0, 0), t: round(avg(vals(rows, 't')) ?? 0),
          sp: gusts.length > 1 ? round(Math.max(...gusts) - Math.min(...gusts)) : 0,
        };
      } else if (last) o = { ...last }; // gap (e.g. beyond one source's horizon): hold last value
      else continue;
      const m = marine && marine[id] && marine[id][k];
      o.s = m && m.s != null ? m.s : (last && marine && marine[id] ? last.s ?? 0 : 0);
      series.push(o); last = o;
    }
    if (series.length === keys.length) regions[id] = series;
  }
  return regions;
}

async function collect(list, kind, arg) {
  const t0 = Date.now();
  const res = await Promise.allSettled(list.map(async c => {
    const t = Date.now();
    const data = await c[kind](arg);
    return { c, data, ms: Date.now() - t };
  }));
  return res.map((r, i) => r.status === 'fulfilled'
    ? { id: list[i].id, label: list[i].label, attribution: list[i].attribution, ok: true, ms: r.value.ms, data: r.value.data }
    : { id: list[i].id, label: list[i].label, ok: false, error: r.reason.message, data: {} });
}

// Only successful live results are cached; a fallback is recomputed on every request so the app
// returns to live data as soon as the network does.
async function buildLive(now, sites) {
  const list = await loadConnectors();
  const start = utcMidnight(now), keys = hourKeys(start, HOURS);
  const [fc, mar] = await Promise.all([collect(withKind(list, 'forecast'), 'forecast', { sites }), collect(withKind(list, 'marine'), 'marine', { sites })]);
  const sources = [...fc, ...mar].map(({ data, ...rest }) => rest);
  const good = fc.filter(s => s.ok);
  const fail = msg => Object.assign(new Error(msg), { sources });
  if (!good.length) throw fail('No forecast source reachable: ' + fc.map(s => `${s.id}: ${s.error}`).join('; '));
  const marine = mar.filter(s => s.ok).reduce((acc, s) => ({ ...acc, ...s.data }), {});
  const regions = fuse(keys, good, marine, Object.keys(sites));
  if (!Object.keys(regions).length) throw fail('Forecast sources returned no usable data');
  return { mode: 'live', start: start.toISOString(), nowHour: now.getUTCHours(), generatedAt: now.toISOString(), hours: HOURS, sources, regions };
}

export async function getForecast({ mode = 'auto', now = new Date(), sites = REGIONS } = {}) {
  if (mode === 'demo') return demoForecast(now, 'forced');
  try {
    return await memo(`forecast:${Math.floor(now.getTime() / 600e3)}:${sitesSignature(sites)}`, 10 * 60e3, () => buildLive(now, sites));
  } catch (e) {
    if (mode === 'live') throw e;
    return demoForecast(now, e.message, e.sources || []);
  }
}
