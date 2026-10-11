// Shared by `npm run train` and the optional nightly job (AUTO_TRAIN=1).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { read } from './ingest.js';
import { readTours } from '../lib/sites.js';
import { buildSamples, fitThresholds } from './model.js';

export async function train({ changedAsCancel = false, write = true } = {}) {
  const out = process.env.MODEL_FILE || fileURLToPath(new URL('../../config/thresholds.json', import.meta.url));
  const { tours } = readTours();
  const records = read('outcomes', 1e6);
  const { samples, enriched, skipped } = await buildSamples(records, tours, { changedAsCancel });
  const fit = fitThresholds(samples);
  const model = { trainedAt: new Date().toISOString(), samples: samples.length, tours: fit };
  if (write) writeFileSync(out, JSON.stringify(model, null, 2) + '\n');
  return { model, tours, records: records.length, enriched, skipped, out };
}

// Runs train() once a day at ~03:30 UTC. Errors are logged, never thrown.
export function scheduleNightly() {
  let lastDay = '';
  setInterval(async () => {
    const now = new Date(), day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== 3 || now.getUTCMinutes() < 30 || lastDay === day) return;
    lastDay = day;
    try { const r = await train(); console.log(`[train] ${r.model.samples} samples, ${Object.values(r.model.tours).filter(t => t.status === 'learned').length} tour(s) learned`); }
    catch (e) { console.error('[train] failed:', e.message); }
  }, 60e3).unref();
}
