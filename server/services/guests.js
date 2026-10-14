// Guest records: the people on each booking, with contact details, so they can be warned and can choose
// what to do. These hold personal data (name, email, phone): they live only in data/store/, are deleted
// automatically after policy.retentionDays, and can be erased per booking (right to erasure).
import { col } from '../lib/store.js';
import { normalizeDeparture, num } from '../lib/csv.js';
import { getPolicy } from './policy.js';

const guests = () => col('guests');
export const guestId = (ref, departureIso) => `${ref}|${departureIso}`;

export function normalizePhone(p) {
  if (p == null || p === '') return '';
  let s = String(p).replace(/[\s().-]/g, '');
  if (/^00\d+/.test(s)) s = '+' + s.slice(2);
  if (/^\d{7}$/.test(s)) s = '+354' + s;                 // Icelandic local number
  return s;
}

export function validateGuest(g) {
  if (g == null || typeof g !== 'object' || Array.isArray(g)) return 'record must be an object';
  if (!g.ref || !String(g.ref).trim()) return 'ref (booking reference) is required';
  if (g.tourId == null || g.tourId === '') return 'tourId is required';
  if (!g.departure || Number.isNaN(Date.parse(normalizeDeparture(g.departure)))) return 'departure must be an ISO date-time';
  if (!Number.isFinite(num(g.pax)) || num(g.pax) < 1) return 'pax must be a number ≥ 1';
  const email = String(g.email || '').trim(), phone = normalizePhone(g.phone);
  if (!email && !phone) return 'email or phone is required (otherwise the guest cannot be reached)';
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'email looks invalid';
  if (phone && !/^\+\d{7,15}$/.test(phone)) return 'phone must be international, e.g. +3545551234';
  if (g.lang && !['en', 'de', 'is'].includes(g.lang)) return 'lang must be en, de or is';
  return null;
}

export function normalizeGuest(g) {
  const departure = new Date(normalizeDeparture(g.departure)).toISOString();
  const ref = String(g.ref).trim();
  return {
    id: guestId(ref, departure), ref, tourId: /^\d+$/.test(String(g.tourId)) ? +g.tourId : g.tourId, departure,
    pax: Math.round(num(g.pax)), name: String(g.name || '').trim(), email: String(g.email || '').trim().toLowerCase(),
    phone: normalizePhone(g.phone), lang: g.lang || 'en', paidISK: num(g.paidISK) ?? null,
    source: g.source || 'api', updatedAt: new Date().toISOString(),
  };
}

export function upsertGuests(list) {
  const errors = [];
  list.forEach((g, i) => { const e = validateGuest(g); if (e) errors.push({ index: i, error: e }); });
  if (errors.length) return { ok: false, errors };
  const recs = list.map(g => { const n = normalizeGuest(g); const old = guests().get(n.id); return { ...n, createdAt: old ? old.createdAt : n.updatedAt }; });
  guests().putMany(recs);
  return { ok: true, accepted: recs.length };
}

export const getGuest = id => guests().get(id);
export function listGuests({ tourId, departure } = {}) {
  return guests().find(g => (tourId == null || String(g.tourId) === String(tourId)) && (!departure || g.departure === new Date(departure).toISOString()))
    .sort((a, b) => a.departure.localeCompare(b.departure) || a.name.localeCompare(b.name));
}

// Right to erasure: remove the guest, their cases, voucher links and stored messages.
export function eraseBooking(ref) {
  let n = 0;
  for (const g of guests().find(g => g.ref === ref)) { guests().remove(g.id); n++; }
  const cases = col('cases').find(c => c.ref === ref);
  for (const c of cases) {
    for (const m of col('outbox').find(m => m.caseId === c.id)) col('outbox').remove(m.id);
    for (const v of col('vouchers').find(v => v.caseId === c.id)) col('vouchers').remove(v.id);
    col('cases').remove(c.id);
  }
  return { guests: n, cases: cases.length };
}

// Delete guest data once the departure is more than retentionDays in the past.
export function purgeExpired(now = new Date()) {
  const cutoff = now.getTime() - getPolicy().retentionDays * 86400e3;
  const old = guests().find(g => Date.parse(g.departure) < cutoff);
  const refs = [...new Set(old.map(g => g.ref))];
  refs.forEach(eraseBooking);
  return { guests: old.length, refs: refs.length };
}

export function scheduleRetention() {
  const run = () => { try { const r = purgeExpired(); if (r.guests) console.log(`[retention] erased ${r.guests} guest record(s)`); } catch (e) { console.error('[retention] failed:', e.message); } };
  setTimeout(run, 5000).unref();
  setInterval(run, 6 * 3600e3).unref();
}

// CSV columns: ref;tourId;departure;pax;name;email;phone;lang;paidISK
export function fromCsvRows(rows) {
  const ok = [], errors = [];
  rows.forEach((r, i) => {
    const g = { ...r, source: 'import' };
    const e = validateGuest(g);
    if (e) errors.push({ row: i + 1, error: e }); else ok.push(g);
  });
  return { guests: ok, errors };
}
