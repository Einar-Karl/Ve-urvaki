// Connection status for the "Tengingar" panel and `npm run check`.
import { memo } from '../lib/cache.js';
import { loadConnectors } from '../registry.js';

export async function checkAll({ force = false } = {}) {
  const run = async () => {
    const list = await loadConnectors();
    return Promise.all(list.map(async c => {
      const base = { id: c.id, label: c.label, kinds: c.kinds, license: c.license, attribution: c.attribution };
      if (c.configured && !c.configured()) return { ...base, status: 'unconfigured', detail: 'Not configured (see docs/ADDONS.md)' };
      const t = Date.now();
      try { const detail = await c.ping(); return { ...base, status: 'ok', ms: Date.now() - t, detail }; }
      catch (e) { return { ...base, status: e.unconfigured ? 'unconfigured' : 'error', ms: Date.now() - t, detail: e.message }; }
    }));
  };
  return force ? run() : memo('health', 60e3, run);
}
