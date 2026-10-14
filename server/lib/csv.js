// CSV helpers for European Excel exports: ';' delimiter, ',' decimals, UTF-8 BOM, quoted cells.
export function parseCsv(text) {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!rows.length) return [];
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
  let m = String(s).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T](\d{1,2}):(\d\d)$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:00Z`;
  m = String(s).match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d{1,2}):(\d\d)(?::\d\d)?Z?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}:00Z`;
  return s;
}

export const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : undefined; };
