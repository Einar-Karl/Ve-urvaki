// `npm run report` — shadow-mode scorecard: how often did the model's recommendation match what the
// duty managers decided, and is its probability well calibrated? Use it to decide when to go live.
import { read } from '../server/services/ingest.js';
import { readTours } from '../server/lib/sites.js';
import { evaluate } from '../server/services/model.js';

const all = read('outcomes', 1e6), { tours } = readTours();
const pct = x => (x == null ? '–' : Math.round(x * 100) + '%');
const show = (title, ev) => {
  console.log(`\n${title}: ${ev.n} live decisions with a forecast snapshot`);
  if (!ev.n) return;
  console.log(`  agreement with duty manager (cancel if model ≥ 50%): ${pct(ev.agreement)}`);
  console.log(`  model said "go" but they cancelled: ${ev.missedCancellations}   ·   model said "cancel" but they ran: ${ev.falseAlarms}`);
  console.log('  model probability  →  actually cancelled');
  for (const b of ev.calibration) console.log(`    ${pct(b.from).padStart(4)}–${pct(b.to).padEnd(4)}  n=${String(b.n).padStart(3)}   ${pct(b.observed)}`);
};
show('ALL TOURS', evaluate(all));
for (const t of tours) { const ev = evaluate(all.filter(r => String(r.tourId) === String(t.id))); if (ev.n) show(`${t.name} (#${t.id})`, ev); }
if (!all.some(r => r.mode === 'live')) console.log('\nNo live decisions recorded yet. Record decisions in the dashboard ("Ákvörðun vaktstjóra") while it shows "Beint".');
