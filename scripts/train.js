// `npm run train` — learn per-tour cancellation thresholds from recorded decisions.
// Reads data/ingest/outcomes.jsonl, writes config/thresholds.json (served at /api/model and applied
// by the dashboard). Needs internet only if imported outcomes lack a forecast snapshot (they are then
// matched to ERA5 archive weather). With AUTO_TRAIN=1 the server also runs this nightly.
import { train } from '../server/services/train.js';

const { model, tours, records, enriched, skipped, out } = await train({ changedAsCancel: process.argv.includes('--changed-as-cancel') });
console.log(`outcomes read: ${records} · usable samples: ${model.samples} (${enriched} matched to archive weather, ${skipped} too recent to match)\n`);
for (const t of tours) {
  const f = model.tours[t.id];
  console.log(`${String(t.id).padStart(3)} ${t.name.padEnd(34)} ${f ? (f.status === 'learned' ? `LEARNED gust ${f.g[0]}–${f.g[1]} m/s (50% at ${f.p50}) from ${f.n} decisions` : `default kept: ${f.reason} (have ${f.n}, ${f.cancelled} cancelled)`) : 'no decisions yet'}`);
}
console.log(`\nwrote ${out}`);
