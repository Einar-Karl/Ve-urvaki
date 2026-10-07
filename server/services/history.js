// Historical weather per region for the "Saga" panel: ERA5 hourly gust and precipitation
// for the 30 days ending 6 days ago (the archive lags real time by a few days).
import { memo } from '../lib/cache.js';
import { utcMidnight } from '../lib/time.js';
import { loadConnectors, withKind } from '../registry.js';
import { demoHistory } from './demo.js';

const DAYS = 30;
const ymd = d => d.toISOString().slice(0, 10);

export async function getHistory({ mode = 'auto', now = new Date() } = {}) {
  if (mode === 'demo') return demoHistory(now);
  const endD = new Date(utcMidnight(now).getTime() - 6 * 86400e3);
  const startD = new Date(endD.getTime() - (DAYS - 1) * 86400e3);
  try {
    return await memo(`history:${ymd(endD)}`, 6 * 3600e3, async () => {
      const c = withKind(await loadConnectors(), 'history')[0];
      if (!c) throw new Error('no history connector');
      const data = await c.history({ start: ymd(startD), end: ymd(endD) });
      const regions = {};
      for (const [id, byHour] of Object.entries(data)) {
        const keys = Object.keys(byHour).sort();
        regions[id] = { t: keys, g: keys.map(k => byHour[k].g), p: keys.map(k => byHour[k].p) };
      }
      if (!Object.keys(regions).length) throw new Error('empty history');
      return { mode: 'live', source: c.id, attribution: c.attribution, days: DAYS, start: startD.toISOString(), end: endD.toISOString(), regions };
    });
  } catch (e) {
    if (mode === 'live') throw e;
    return { ...demoHistory(now), demoReason: e.message };
  }
}
