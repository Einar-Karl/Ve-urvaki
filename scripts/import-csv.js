// `node scripts/import-csv.js outcomes|bookings file.csv`
// Loads a spreadsheet export (Excel "CSV (semicolon delimited)", comma decimals OK) through the same
// validation as the ingest API. Use it to backfill past seasons' cancellation decisions.
//   outcomes columns:  tourId;departure;outcome;reason         e.g. 2;2025-02-14 09:00;cancelled;wind
//   bookings columns:  tourId;departure;pax;capacity
// `departure` accepts ISO or "yyyy-MM-dd HH:mm" / "dd.MM.yyyy HH:mm" (Iceland local time = UTC).
import { readFileSync } from 'node:fs';
import { append, KINDS } from '../server/services/ingest.js';

export function parseCsv(text) {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const delim = rows[0].includes(';') ? ';' : ',';
  const split = line => { const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) { const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === delim) { out.push(cur); cur = ''; } else cur += c; }
    out.push(cur); return out; };
  const head = split(rows[0]).map(h => h.trim());
  return rows.slice(1).map(l => Object.fromEntries(split(l).map((v, i) => [head[i], v.trim()])));
}

export function normalizeDeparture(s) {
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d\d)$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:00Z`;
  m = s.match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d{1,2}):(\d\d)(?::\d\d)?Z?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:00Z`;
  return s;
}

export function toRecords(kind, rows) {
  return rows.map(r => {
    const rec = { ...r, tourId: /^\d+$/.test(r.tourId) ? +r.tourId : r.tourId, departure: normalizeDeparture(r.departure || ''), source: 'import' };
    for (const k of ['pax', 'capacity']) if (rec[k] !== undefined) rec[k] = parseFloat(String(rec[k]).replace(',', '.'));
    return rec;
  });
}

if (process.argv[1] && process.argv[1].endsWith('import-csv.js')) {
  const [kind, file] = process.argv.slice(2);
  if (!KINDS.includes(kind) || !file) { console.error('usage: node scripts/import-csv.js outcomes|bookings file.csv'); process.exit(2); }
  const recs = toRecords(kind, parseCsv(readFileSync(file, 'utf8')));
  const r = append(kind, recs);
  if (!r.ok) { console.error('Nothing imported. Fix these rows (row numbers are 1-based data rows):'); r.errors.forEach(e => console.error(`  row ${e.index + 1}: ${e.error}`)); process.exit(1); }
  console.log(`imported ${r.accepted} ${kind}`);
}
