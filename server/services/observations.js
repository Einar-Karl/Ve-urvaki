// Latest station readings per site, merged across every enabled `observation` connector
// (Icelandic Met Office + Vegagerðin road-weather stations). For each site the first source that
// has a station within range wins, but a reading with a gust value beats one without.
import { memo } from '../lib/cache.js';
import { sitesSignature } from '../lib/sites.js';
import { loadConnectors, withKind } from '../registry.js';

export function mergeObservations(parts) {
  const merged = {};
  for (const { id, regions } of parts) {
    for (const [site, o] of Object.entries(regions || {})) {
      const cur = merged[site];
      if (!cur || (cur.g == null && o.g != null)) merged[site] = { ...o, source: id };
    }
  }
  return merged;
}

export async function getObservations({ sites }) {
  const list = withKind(await loadConnectors(), 'observation');
  if (!list.length) throw new Error('no connector provides "observation"');
  return memo(`obs:${sitesSignature(sites)}:${list.map(c => c.id).join(',')}`, 5 * 60e3, async () => {
    const res = await Promise.allSettled(list.map(async c => ({ id: c.id, attribution: c.attribution, ...(await c.observation({ sites })) })));
    const ok = res.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (!ok.length) throw new Error('No observation source reachable: ' + res.map((r, i) => `${list[i].id}: ${r.reason.message}`).join('; '));
    return { sources: ok.map(o => ({ id: o.id, attribution: o.attribution, stations: o.stations })), regions: mergeObservations(ok) };
  });
}
