// A "case" is one guest's notification about one departure and what they chose. Lifecycle:
//   prepared (links created, nothing sent) → sent → responded (guest chose) → closed (ops finished)
// A choice moves  pending → approved → done  (or rejected). Until Bókun write-back is wired, "approved" /
// "done" are performed by a person in the booking system; the admin page lists exactly what to do.
import { col } from '../lib/store.js';
import { newId, newToken, voucherCode } from '../lib/tokens.js';
import { t, normLang, STRINGS, plural, when, money, day, LANGS } from '../lib/i18n.js';
import { getPolicy } from './policy.js';
import { getSettings } from '../lib/settings.js';
import { readTours } from '../lib/sites.js';
import { getBookings } from './bookings.js';
import { listGuests, getGuest } from './guests.js';
import { compose, deliver, guestLink, reasonText } from './messaging.js';

const cases = () => col('cases'), vouchers = () => col('vouchers'), auditCol = () => col('audit');
const HOUR = 3600e3, DAY = 86400e3;

export function audit(who, action, details = {}) {
  auditCol().put({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), who: who || 'system', action, details });
}
export const listAudit = (limit = 200) => auditCol().all().sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);

// Same rule as the dashboard: decide 6 h before an afternoon departure, or at 18:00 the evening before a morning one.
export function decisionDeadline(depIso) {
  const d = new Date(depIso), H = d.getUTCHours();
  return new Date(d.getTime() - (H >= 12 ? 6 : H + 6) * HOUR).toISOString();
}

const outlook = p => (p == null ? 'unknown' : p < 0.2 ? 'good' : p < 0.5 ? 'ok' : 'poor');

export function reasonFrom(R, tourFactors) {
  if (!R) return { code: 'generic' };
  if (R.road) return { code: 'road', road: R.road[0] };
  const p = R.parts && R.parts[0];
  if (!p || p.r < 0.15) return { code: 'generic' };
  const limit = tourFactors && tourFactors[p.k] ? tourFactors[p.k][1] : null;
  switch (p.k) {
    case 'g': return { code: 'wind', gust: p.v, limit };
    case 'p': return { code: 'rain', precip: p.v };
    case 's': return { code: 'waves', waves: p.v };
    case 'c': return { code: 'cloud' };
    default: return { code: 'generic' };
  }
}

// ---------- creating and sending ----------
export function prepareCases({ tourId, departure, kind = 'warning', who, ctx, reason }) {
  if (!['warning', 'cancelled'].includes(kind)) throw new Error('kind must be warning or cancelled');
  const depIso = new Date(departure).toISOString();
  const policy = getPolicy();
  const R = ctx && ctx.riskAt(tourId, depIso);
  const r = reason || reasonFrom(R, ctx && ctx.factors(tourId));
  const created = [], existing = [];
  for (const g of listGuests({ tourId, departure: depIso })) {
    const open = cases().find(c => c.guestId === g.id && c.kind === kind && c.state !== 'closed')[0];
    if (open) { existing.push(open); continue; }
    const c = { id: newId('case_'), token: newToken(), guestId: g.id, ref: g.ref, tourId: g.tourId, departure: depIso, kind, reason: r,
      riskAtCreate: R ? { cancel: R.cancel, status: R.status } : null, createdAt: new Date().toISOString(), createdBy: who || 'system',
      state: 'prepared', expiresAt: new Date(Date.parse(depIso) + policy.linkValidDays * DAY).toISOString(), sent: [], choice: null, history: [] };
    cases().put(c); created.push(c);
  }
  if (created.length) audit(who, 'cases.prepare', { tourId, departure: depIso, kind, count: created.length });
  return { created, existing };
}

function context(c, g, tour, lang, extra = {}) {
  return { lang, guest: g, tourName: tour ? tour.name : String(c.tourId), departure: c.departure, link: guestLink(c.token),
    deadlineIso: decisionDeadline(c.departure), reason: c.reason, phone: getSettings().brand.phone, ...extra };
}
const tourOf = id => readTours().tours.find(t => String(t.id) === String(id));
const langOf = g => normLang(g.lang || getSettings().defaultLang);

export function preview(c) {
  const g = getGuest(c.guestId); if (!g) return null;
  const lang = langOf(g), kind = c.kind;
  const m = compose(kind, context(c, g, tourOf(c.tourId), lang));
  return { lang, guest: { name: g.name, email: g.email, phone: g.phone }, sms: m.sms.text, email: { subject: m.email.subject, text: m.email.text } };
}

export async function sendCase(id, who) {
  const c = cases().get(id); if (!c) throw new Error('no such case');
  if (c.state === 'closed') throw new Error('case is closed');
  const g = getGuest(c.guestId); if (!g) throw new Error('guest record no longer exists');
  const lang = langOf(g);
  const recs = await deliver({ caseId: c.id, kind: c.kind, guest: g, lang, composed: compose(c.kind, context(c, g, tourOf(c.tourId), lang)) });
  const next = { ...c, state: c.state === 'prepared' ? 'sent' : c.state, sent: [...c.sent, { at: new Date().toISOString(), messages: recs.map(r => ({ id: r.id, channel: r.channel, status: r.status })) }] };
  cases().put(next);
  audit(who, 'cases.send', { id, statuses: recs.map(r => `${r.channel}:${r.status}`) });
  return recs;
}

// ---------- what a guest sees ----------
async function seatMap(tours, days) {
  const b = await getBookings({ tours, days });
  const m = new Map();
  for (const d of b.departures) m.set(`${d.tourId}|${new Date(d.departure).toISOString()}`, { pax: d.pax, capacity: d.capacity });
  return { map: m, known: b.mode !== 'none' };
}

// seats already promised to other guests who picked this departure but are not yet processed
function held(depKey) {
  let n = 0;
  for (const c of cases().all()) {
    const ch = c.choice;
    if (!ch || !['pending', 'approved'].includes(ch.status) || !['rebook', 'switch'].includes(ch.type)) continue;
    if (`${ch.tourId ?? c.tourId}|${ch.departure}` === depKey) n += getGuest(c.guestId)?.pax || 0;
  }
  return n;
}

export async function alternatives(c, g, ctx, { nowMs = Date.now() } = {}) {
  const policy = getPolicy(), tours = readTours().tours, orig = tours.find(x => String(x.id) === String(c.tourId));
  const days = Math.max(2, policy.rebookWindowDays);
  const { map, known } = await seatMap(tours, days + 1);
  const today = new Date(nowMs); today.setUTCHours(0, 0, 0, 0);
  const minMs = nowMs + 6 * HOUR;
  const list = [];
  for (const tour of tours) {
    for (let d = 0; d <= days; d++) {
      for (const hhmm of tour.departures || []) {
        const iso = new Date(today.getTime() + d * DAY + (parseInt(hhmm, 10) * 60 + parseInt(hhmm.split(':')[1] || 0, 10)) * 60e3).toISOString();
        if (Date.parse(iso) < minMs) continue;
        const same = String(tour.id) === String(c.tourId);
        if (same && iso === c.departure) continue;
        if (!same && d > Math.min(days, 7)) continue;
        const key = `${tour.id}|${iso}`, s = map.get(key);
        const cap = s ? s.capacity || tour.capacity : tour.capacity;
        const seatsLeft = known || s ? Math.max(0, cap - (s ? s.pax : 0) - held(key)) : null;
        if (seatsLeft != null && seatsLeft < g.pax) continue;
        const R = ctx ? ctx.riskAt(tour.id, iso) : null;
        const lvl = outlook(R ? R.cancel : null);
        if (lvl === 'poor') continue;
        list.push({ tourId: tour.id, tourName: tour.name, departure: iso, seatsLeft, outlook: lvl, cancel: R ? R.cancel : null,
          priceDiffISK: same ? 0 : Math.round(((tour.priceISK || 0) - (orig ? orig.priceISK || 0 : 0)) * g.pax), same });
      }
    }
  }
  const rank = o => (o.outlook === 'good' ? 0 : o.outlook === 'ok' ? 1 : 2);
  const sortFn = (a, b) => rank(a) - rank(b) || a.departure.localeCompare(b.departure);
  return {
    rebook: list.filter(x => x.same).sort(sortFn).slice(0, 8),
    switch: list.filter(x => !x.same && x.outlook !== 'unknown').sort(sortFn).slice(0, 8),
    days,
  };
}

export function money_options(c, g, tour) {
  const policy = getPolicy();
  const base = g.paidISK ?? Math.round((tour?.priceISK || 0) * g.pax);
  const bonus = policy.creditBonusPct;
  return { refundISK: base, creditISK: Math.round(base * (1 + bonus / 100)), bonusPct: bonus, months: policy.creditValidMonths };
}

const findCase = token => (token ? cases().find(c => c.token === token)[0] || null : null);

export async function guestView(token, { lang: wanted, ctx, nowMs = Date.now() } = {}) {
  const c = findCase(token);
  if (!c || Date.parse(c.expiresAt) < nowMs) return null;
  const g = getGuest(c.guestId);
  if (!g) return null;
  const tour = tourOf(c.tourId);
  const lang = normLang(wanted || g.lang || getSettings().defaultLang);
  const policy = getPolicy(), s = getSettings();
  const deadlineIso = decisionDeadline(c.departure);
  const m = money_options(c, g, tour);
  const alts = c.choice && ['approved', 'done'].includes(c.choice.status) ? null : await alternatives(c, g, ctx, { nowMs });
  const keepOk = c.kind === 'warning' && Date.parse(deadlineIso) > nowMs;
  const offer = policy.offer;
  const voucher = c.choice && c.choice.voucherCode ? vouchers().find(v => v.code === c.choice.voucherCode)[0] : null;
  return {
    lang, langs: LANGS, strings: STRINGS[lang],
    brand: s.brand, contact: { phone: s.brand.phone, email: s.brand.email },
    guest: { firstName: (g.name || '').split(' ')[0], pax: g.pax, ref: g.ref },
    tour: { id: c.tourId, name: tour ? tour.name : String(c.tourId), priceISK: tour?.priceISK ?? null },
    departure: c.departure, kind: c.kind, deadlineIso,
    reason: { ...c.reason, text: reasonText(lang, c.reason) },
    options: {
      rebook: offer.rebook && alts ? alts.rebook : [], switch: offer.switch && alts ? alts.switch : [],
      credit: offer.credit ? { valueISK: m.creditISK, bonusPct: m.bonusPct, months: m.months } : null,
      refund: offer.refund ? { amountISK: m.refundISK } : null,
      keep: offer.keep && keepOk,
      windowDays: alts ? alts.days : policy.rebookWindowDays,
    },
    choice: c.choice ? { type: c.choice.type, status: c.choice.status, departure: c.choice.departure || null, tourId: c.choice.tourId ?? null, tourName: c.choice.tourName || null,
      amountISK: c.choice.amountISK ?? null, voucherCode: voucher && ['approved', 'done'].includes(c.choice.status) ? voucher.code : null, at: c.choice.at, text: choiceText(lang, c.choice, g) } : null,
    responseHours: policy.responseHours,
    fmt: { guestsText: plural(lang, g.pax), whenText: when(c.departure, lang), dayText: day(c.departure, lang) },
  };
}

export function choiceText(lang, ch, g) {
  switch (ch.type) {
    case 'rebook': return t(lang, 'you_chose_rebook', { date: when(ch.departure, lang) });
    case 'switch': return t(lang, 'you_chose_switch', { tour: ch.tourName, date: when(ch.departure, lang) });
    case 'credit': return t(lang, 'you_chose_credit', { value: money(ch.amountISK, lang) });
    case 'refund': return t(lang, 'you_chose_refund', { amount: money(ch.amountISK, lang) });
    default: return t(lang, 'you_chose_keep');
  }
}

// ---------- guest chooses ----------
export class GuestError extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }

export async function choose(token, body, { ctx, nowMs = Date.now() } = {}) {
  const c = findCase(token);
  if (!c || Date.parse(c.expiresAt) < nowMs) throw new GuestError('invalid or expired link', 404);
  const g = getGuest(c.guestId); if (!g) throw new GuestError('invalid or expired link', 404);
  if (c.choice && ['approved', 'done'].includes(c.choice.status)) throw new GuestError('already being handled', 409);
  const policy = getPolicy(), tour = tourOf(c.tourId), m = money_options(c, g, tour);
  const type = body && body.type;
  if (!['rebook', 'switch', 'credit', 'refund', 'keep'].includes(type) || !policy.offer[type]) throw new GuestError('that option is not available');
  let choice = { type, at: new Date(nowMs).toISOString(), status: 'pending' };

  if (type === 'rebook' || type === 'switch') {
    const alts = await alternatives(c, g, ctx, { nowMs });
    const pool = type === 'rebook' ? alts.rebook : alts.switch;
    const dep = body.departure && new Date(body.departure).toISOString();
    const pick = pool.find(a => a.departure === dep && (type === 'rebook' || String(a.tourId) === String(body.tourId)));
    if (!pick) throw new GuestError('that date is no longer available. Please pick another');
    choice = { ...choice, departure: pick.departure, tourId: pick.tourId, tourName: pick.tourName, priceDiffISK: pick.priceDiffISK };
  } else if (type === 'credit') choice.amountISK = m.creditISK;
  else if (type === 'refund') choice.amountISK = m.refundISK;
  else if (type === 'keep' && !(c.kind === 'warning' && Date.parse(decisionDeadline(c.departure)) > nowMs)) throw new GuestError('that option is not available');

  const prev = c.choice ? [...c.history, { ...c.choice, replacedAt: choice.at }] : c.history;
  const next = { ...c, choice, history: prev, state: 'responded' };
  cases().put(next);
  audit(`guest:${g.ref}`, 'guest.choose', { id: c.id, type, departure: choice.departure });
  const lang = langOf(g);
  if (policy.autoApprove[type]) await resolve(c.id, 'approve', 'auto-approved by policy', 'system');
  else await notify('confirm', cases().get(c.id), g, lang);
  return guestView(token, { ctx, nowMs });
}

async function notify(kind, c, g, lang) {
  const tour = tourOf(c.tourId);
  const composed = compose(kind, context(c, g, tour, lang, { choiceText: c.choice ? choiceText(lang, c.choice, g) : '' }));
  return deliver({ caseId: c.id, kind, guest: g, lang, composed });
}

// ---------- operations ----------
export async function resolve(id, action, note, who) {
  let c = cases().get(id); if (!c) throw new Error('no such case');
  const g = getGuest(c.guestId), lang = g ? langOf(g) : 'en';
  if (!c.choice && action !== 'close') throw new Error('guest has not chosen yet');
  const now = new Date().toISOString(), policy = getPolicy();
  if (action === 'approve') {
    const ch = { ...c.choice, status: 'approved', decidedBy: who, decidedAt: now, note: note || '' };
    if (ch.type === 'credit' && !ch.voucherCode) {
      const code = voucherCode();
      vouchers().put({ id: code, code, caseId: c.id, ref: c.ref, valueISK: ch.amountISK, status: 'issued', createdAt: now, expiresAt: new Date(Date.now() + policy.creditValidMonths * 30.4 * DAY).toISOString() });
      ch.voucherCode = code;
    }
    c = { ...c, choice: ch };
    cases().put(c);
    if (g) await notify('approved', c, g, lang);
  } else if (action === 'done') {
    c = { ...c, choice: { ...c.choice, status: 'done', decidedBy: who, decidedAt: now, note: note || c.choice.note || '' }, state: 'closed' };
    cases().put(c);
  } else if (action === 'reject') {
    c = { ...c, choice: { ...c.choice, status: 'rejected', decidedBy: who, decidedAt: now, note: note || '' } };
    cases().put(c);
    if (g) await notify('rejected', c, g, lang);
  } else if (action === 'reopen') {
    c = { ...c, history: [...c.history, { ...c.choice, reopenedAt: now }], choice: null, state: 'sent' };
    cases().put(c);
  } else throw new Error('action must be approve, done, reject or reopen');
  audit(who, `case.${action}`, { id, note: note || '' });
  return c;
}

// What a person has to do in the booking system for this choice (shown in the admin page).
export function todoFor(c, g) {
  const ch = c.choice; if (!ch) return null;
  const who = `${g?.name || 'guest'} · booking ${c.ref} · ${g?.pax || '?'} pax`;
  switch (ch.type) {
    case 'rebook': return `Move ${who} from ${c.departure.slice(0, 16)} to ${ch.departure.slice(0, 16)} (same tour).`;
    case 'switch': return `Move ${who} to "${ch.tourName}" on ${ch.departure.slice(0, 16)}. Price difference: ${ch.priceDiffISK} ISK.`;
    case 'credit': return `Create a voucher / promo code ${ch.voucherCode || '(issued on approval)'} worth ${ch.amountISK} ISK for ${who}; cancel the original booking.`;
    case 'refund': return `Refund ${ch.amountISK} ISK to the original payment for ${who}; cancel the booking.`;
    default: return `Keep ${who}; send the final go/no-go by ${decisionDeadline(c.departure).slice(0, 16)}.`;
  }
}

export function listCases({ state, choiceStatus, tourId, departure } = {}) {
  return cases().all().filter(c => (!state || c.state === state) && (!choiceStatus || (c.choice && c.choice.status === choiceStatus)) && (tourId == null || String(c.tourId) === String(tourId)) && (!departure || c.departure === departure))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(c => { const g = getGuest(c.guestId); return { ...c, guest: g ? { name: g.name, email: g.email, phone: g.phone, pax: g.pax, lang: g.lang } : null, tourName: tourOf(c.tourId)?.name || String(c.tourId), todo: todoFor(c, g) }; });
}
export const getCase = id => cases().get(id);
export const listVouchers = () => vouchers().all().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
