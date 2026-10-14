// `npm run check` — run this on a machine with internet access. It pings every connector with a
// real request and prints the result, so you can see exactly which live feeds work from there.
// For the IMO connector it also prints the raw field names, to confirm the field mapping.
import { checkAll } from '../server/services/health.js';
import { getJson } from '../server/lib/http.js';

const icon = { ok: '✔', error: '✘', unconfigured: '–' };
const rows = await checkAll({ force: true });
console.log('\nVeðurvaki connection check\n');
for (const r of rows) console.log(`${icon[r.status]} ${r.label.padEnd(32)} ${r.status.padEnd(13)} ${String(r.ms ?? '').padStart(5)} ms  ${r.detail}`);

try {
  const j = await getJson(process.env.IMO_OBS_URL || 'https://api.vedur.is/weather/observations/aws/hour/latest');
  const rows2 = Array.isArray(j) ? j : (j.data || j.stations || j.observations || Object.values(j));
  console.log('\nIMO sample record (verify field names against server/connectors/imo.js ALIAS):');
  console.log(JSON.stringify(rows2[0], null, 2));
} catch (e) { console.log('\nIMO sample unavailable:', e.message); }

for (const [label, url] of [['Vegagerðin road conditions', process.env.VEGAGERDIN_ROADS_URL || 'https://gagnaveita.vegagerdin.is/api/faerd2017_1'], ['Vegagerðin weather stations', process.env.VEGAGERDIN_STATIONS_URL || 'https://gagnaveita.vegagerdin.is/api/vedur2014_1']]) {
  try { const j = await getJson(url, { timeout: 15000 }); const r = Array.isArray(j) ? j : (j.data || Object.values(j)); console.log(`\n${label}: ${r.length} records, sample:`); console.log(JSON.stringify(r[0], null, 2)); }
  catch (e) { console.log(`\n${label} sample unavailable:`, e.message); }
}

const bad = rows.filter(r => r.status === 'error');
console.log(bad.length ? `\n${bad.length} connector(s) failing — the app will fall back to demo data for forecasts.` : '\nAll configured connectors reachable.');
process.exit(bad.length ? 1 : 0);
