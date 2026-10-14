// Ingest API: lets other programs (booking system, ops tools, spreadsheets) push data in.
//   POST /api/ingest/outcomes   one departure's result, i.e. the training label for the risk model
//   POST /api/ingest/bookings   booking snapshots per departure
//   POST /api/ingest/events     anything else worth keeping (manual overrides, notes)
// Stored as append-only JSON Lines under data/ingest/. Set INGEST_TOKEN to require x-api-key.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = process.env.INGEST_DIR || fileURLToPath(new URL('../../data/ingest/', import.meta.url));
export const KINDS = ['outcomes', 'bookings', 'events', 'guests'];
const OUTCOMES = ['ran', 'cancelled', 'changed'];

export function validate(kind, rec) {
  if (rec == null || typeof rec !== 'object' || Array.isArray(rec)) return 'record must be an object';
  if (kind === 'outcomes') {
    if (!rec.tourId && !rec.tour) return 'tourId (or tour) is required';
    if (!rec.departure || Number.isNaN(Date.parse(rec.departure))) return 'departure must be an ISO date-time';
    if (!OUTCOMES.includes(rec.outcome)) return `outcome must be one of ${OUTCOMES.join(', ')}`;
  }
  if (kind === 'bookings') {
    if (!rec.tourId && !rec.tour) return 'tourId (or tour) is required';
    if (!rec.departure || Number.isNaN(Date.parse(rec.departure))) return 'departure must be an ISO date-time';
    if (!Number.isFinite(rec.pax)) return 'pax must be a number';
  }
  return null;
}

export function append(kind, body) {
  const recs = Array.isArray(body) ? body : [body];
  const errors = [];
  recs.forEach((r, i) => { const e = validate(kind, r); if (e) errors.push({ index: i, error: e }); });
  if (errors.length) return { ok: false, errors };
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  const at = new Date().toISOString();
  appendFileSync(`${DIR}${kind}.jsonl`, recs.map(r => JSON.stringify({ receivedAt: at, ...r })).join('\n') + '\n');
  return { ok: true, accepted: recs.length };
}

export function read(kind, limit = 100) {
  const f = `${DIR}${kind}.jsonl`;
  if (!existsSync(f)) return [];
  const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
  return lines.slice(-limit).map(l => JSON.parse(l));
}

// European Excel: ';' as column separator and ',' as decimal mark.
export function toCsvEU(rows) {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const cell = v => {
    if (v == null) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => cell(r[c])).join(';'))].join('\r\n');
}
