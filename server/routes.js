// Guest, partner and admin HTTP endpoints. Each handler returns true when it handled the request.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listGuests, upsertGuests, eraseBooking, purgeExpired, fromCsvRows as guestsFromCsv } from './services/guests.js';
import * as tours from './services/toursconfig.js';
import { readTours, buildSites } from './lib/sites.js';
import { getSettings, saveSettings } from './lib/settings.js';
import { getPolicy, savePolicy } from './services/policy.js';
import { createKey, listKeys, revokeKey } from './services/keys.js';
import { checkAll } from './services/health.js';
import { loadModel, evaluate } from './services/model.js';
import { train } from './services/train.js';
import { read as readIngest, toCsvEU } from './services/ingest.js';
import { getRoads } from './services/roads.js';
import { getBookings } from './services/bookings.js';
import { getRiskContext, resetRiskContext } from './services/riskctx.js';
import * as cases from './services/cases.js';
import { listOutbox, sendTest, mode as messagingMode } from './services/messaging.js';
import { resetRegistry, loadConnectors, isEnabled } from './registry.js';
import { parseCsv } from './lib/csv.js';
import { col } from './lib/store.js';
import { LANGS } from './lib/i18n.js';
import * as cams from './services/cameras.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOUR = 3600e3;
const bad = (send, res, code, msg, extra) => { send(res, code, { error: msg, ...extra }); return true; };

// ---- per-IP limiter for the public guest endpoints (60 requests per minute) ----
const hits = new Map();
export function limited(ip, max = 60, now = Date.now()) {
  const h = (hits.get(ip) || []).filter(t => now - t < 60e3);
  h.push(now); hits.set(ip, h);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < 60e3)) hits.delete(k);
  return h.length > max;
}

async function riskCtx() { try { return await getRiskContext(); } catch { return null; } }

export async function guestRoutes({ req, res, p, url, send, json }) {
  if (p.startsWith('/g/') && req.method === 'GET') { send(res, 200, readFileSync(`${ROOT}guest.html`), 'text/html; charset=utf-8'); return true; }
  const m = p.match(/^\/api\/guest\/([\w-]+)(\/choose)?$/);
  if (!m) return false;
  const ip = req.socket.remoteAddress || '?';
  if (limited(ip)) return bad(send, res, 429, 'too many requests, please wait a minute');
  try {
    if (!m[2] && req.method === 'GET') {
      const v = await cases.guestView(m[1], { lang: url.searchParams.get('lang') || undefined, ctx: await riskCtx() });
      return v ? (send(res, 200, v), true) : bad(send, res, 404, 'invalid or expired link');
    }
    if (m[2] && req.method === 'POST') {
      const v = await cases.choose(m[1], await json(req), { ctx: await riskCtx() });
      send(res, 200, v); return true;
    }
  } catch (e) {
    if (e instanceof cases.GuestError) return bad(send, res, e.code, e.message);
    throw e;
  }
  return false;
}

export async function partnerRoutes({ req, res, p, send, json }) {
  if (p !== '/api/partner/tours') return false;
  if (req.method === 'GET') { const { demo, tours: t, warnings } = readTours(); send(res, 200, { demo, tours: t, warnings }); return true; }
  if (req.method === 'PUT') {
    const b = await json(req);
    const r = tours.upsert(Array.isArray(b) ? b : b && b.tours ? b.tours : [b]);
    resetRiskContext();
    return r.ok ? (send(res, 200, r), true) : bad(send, res, 422, 'invalid tour data', { errors: r.errors });
  }
  return false;
}

// ---- upcoming departures with risk, guests and cases: the basis of the Notifications tab ----
async function upcomingDepartures() {
  const ctx = await riskCtx(), { tours: list } = readTours();
  const now = Date.now(), out = [];
  const b = await getBookings({ tours: list, days: 4 });
  const pax = new Map(b.departures.map(d => [`${d.tourId}|${new Date(d.departure).toISOString()}`, d.pax]));
  const day0 = new Date(now); day0.setUTCHours(0, 0, 0, 0);
  for (const t of list) for (let d = 0; d < 3; d++) for (const hhmm of t.departures || []) {
    const iso = new Date(day0.getTime() + d * 86400e3 + (parseInt(hhmm, 10) * 60 + parseInt(hhmm.split(':')[1] || 0, 10)) * 60e3).toISOString();
    if (Date.parse(iso) < now - HOUR) continue;
    const R = ctx ? ctx.riskAt(t.id, iso) : null;
    const gs = listGuests({ tourId: t.id, departure: iso });
    const cs = cases.listCases({ tourId: t.id, departure: iso });
    out.push({ tourId: t.id, tourName: t.name, departure: iso, cancel: R ? R.cancel : null, status: R ? R.status : null, road: R && R.road ? R.road : null,
      reason: R ? cases.reasonFrom(R, ctx.factors(t.id)) : null, bookedPax: pax.get(`${t.id}|${iso}`) ?? null,
      guests: gs.length, guestPax: gs.reduce((s, g) => s + g.pax, 0), reachable: gs.filter(g => g.email || g.phone).length,
      cases: cs.length, casesSent: cs.filter(c => c.state !== 'prepared').length, deadline: cases.decisionDeadline(iso) });
  }
  return { forecastMode: ctx ? ctx.forecastMode : 'unavailable', departures: out.sort((a, b) => (b.cancel ?? -1) - (a.cancel ?? -1) || a.departure.localeCompare(b.departure)) };
}

const requestsCsv = () => toCsvEU(cases.listCases().filter(c => c.choice).map(c => ({
  case: c.id, booking: c.ref, guest: c.guest?.name || '', email: c.guest?.email || '', tour: c.tourName, departure: c.departure, type: c.choice.type, status: c.choice.status,
  newDeparture: c.choice.departure || '', newTour: c.choice.tourName || '', amountISK: c.choice.amountISK ?? '', voucher: c.choice.voucherCode || '', chosenAt: c.choice.at, decidedBy: c.choice.decidedBy || '', note: c.choice.note || '', todo: c.todo || '',
})));

export async function adminRoutes({ req, res, p, url, send, json }) {
  if (!p.startsWith('/api/admin/')) return false;
  const who = req.auth?.who || 'admin', M = req.method, seg = p.slice('/api/admin/'.length).split('/');
  const ok = (body = { ok: true }) => { send(res, 200, body); return true; };

  switch (seg[0]) {
    case 'overview': {
      const all = await loadConnectors(), list = cases.listCases();
      return ok({ messagingMode: messagingMode(), publicBaseUrl: process.env.PUBLIC_BASE_URL || null, toursDemo: readTours().demo,
        counts: { tours: readTours().tours.length, guests: listGuests().length, cases: list.length, awaitingGuest: list.filter(c => c.state === 'sent' && !c.choice).length,
          pending: list.filter(c => c.choice && c.choice.status === 'pending').length, approved: list.filter(c => c.choice && c.choice.status === 'approved').length },
        connectors: all.map(c => ({ id: c.id, kinds: c.kinds, enabled: isEnabled(c.id), configured: c.configured ? c.configured() : true })),
        auth: { dashboardPassword: !!process.env.DASHBOARD_PASSWORD, adminPassword: !!process.env.ADMIN_PASSWORD }, langs: LANGS });
    }
    case 'tours': {
      if (M === 'GET' && !seg[1]) { const { demo, tours: t, warnings } = readTours(); return ok({ demo, tours: t, warnings }); }
      if (M === 'PUT' && !seg[1]) { const b = await json(req); const r = tours.saveAll(b.tours || []); resetRiskContext(); cases.audit(who, 'tours.save', { count: b.tours?.length }); return r.ok ? ok(r) : bad(send, res, 422, 'invalid tours', { errors: r.errors }); }
      if (M === 'POST' && !seg[1]) { const r = tours.upsert([await json(req)]); resetRiskContext(); cases.audit(who, 'tours.upsert', {}); return r.ok ? ok(r) : bad(send, res, 422, 'invalid tour', { errors: r.errors }); }
      if (M === 'POST' && seg[1] === 'import') {
        const { tours: parsed, errors } = tours.fromCsvRows(parseCsv((await json(req)).csv || ''));
        if (url.searchParams.get('apply') !== '1') return ok({ preview: parsed, errors });
        if (errors.length) return bad(send, res, 422, 'fix the CSV rows first', { errors });
        const r = tours.upsert(parsed); resetRiskContext(); cases.audit(who, 'tours.import', { count: parsed.length }); return ok(r);
      }
      if (M === 'DELETE' && seg[1]) { const r = tours.remove(decodeURIComponent(seg[1])); resetRiskContext(); cases.audit(who, 'tours.delete', { id: seg[1] }); return r.ok ? ok(r) : bad(send, res, 404, 'no such tour'); }
      return false;
    }
    case 'connectors': {
      if (M === 'GET') { const h = await checkAll({ force: url.searchParams.has('force') }); return ok(h.map(c => ({ ...c, enabled: isEnabled(c.id) }))); }
      if (M === 'PUT' && seg[1]) {
        const b = await json(req), s = getSettings(), off = new Set(s.disabledConnectors);
        b.enabled ? off.delete(seg[1]) : off.add(seg[1]);
        saveSettings({ disabledConnectors: [...off] }); resetRiskContext(); cases.audit(who, 'connector.toggle', { id: seg[1], enabled: !!b.enabled });
        return ok({ id: seg[1], enabled: !!b.enabled });
      }
      return false;
    }
    case 'settings': if (M === 'GET') return ok(getSettings()); if (M === 'PUT') { const r = saveSettings(await json(req)); cases.audit(who, 'settings.save', {}); return ok(r); } return false;
    case 'policy': if (M === 'GET') return ok(getPolicy()); if (M === 'PUT') { const r = savePolicy(await json(req)); cases.audit(who, 'policy.save', {}); return ok(r); } return false;
    case 'guests': {
      if (M === 'GET') return ok(listGuests({ tourId: url.searchParams.get('tourId') ?? undefined, departure: url.searchParams.get('departure') ?? undefined }));
      if (M === 'POST' && !seg[1]) { const b = await json(req); const r = upsertGuests(Array.isArray(b) ? b : [b]); cases.audit(who, 'guests.add', { n: r.accepted }); return r.ok ? ok(r) : bad(send, res, 422, 'invalid guest data', { errors: r.errors }); }
      if (M === 'POST' && seg[1] === 'import') {
        const { guests: g, errors } = guestsFromCsv(parseCsv((await json(req)).csv || ''));
        if (url.searchParams.get('apply') !== '1') return ok({ preview: g.length, errors });
        if (errors.length) return bad(send, res, 422, 'fix the CSV rows first', { errors });
        const r = upsertGuests(g); cases.audit(who, 'guests.import', { n: r.accepted }); return ok(r);
      }
      if (M === 'DELETE' && seg[1]) { const r = eraseBooking(decodeURIComponent(seg[1])); cases.audit(who, 'guests.erase', { ref: seg[1], ...r }); return ok(r); }
      return false;
    }
    case 'departures': return M === 'GET' ? ok(await upcomingDepartures()) : false;
    case 'cases': {
      if (M === 'GET' && !seg[1]) return ok(cases.listCases({ state: url.searchParams.get('state') ?? undefined, choiceStatus: url.searchParams.get('choice') ?? undefined }));
      if (M === 'GET' && seg[2] === 'preview') { const c = cases.getCase(seg[1]); const pv = c && cases.preview(c); return pv ? ok(pv) : bad(send, res, 404, 'no such case'); }
      if (M === 'POST' && seg[1] === 'prepare') {
        const b = await json(req);
        if (b.tourId == null || !b.departure) return bad(send, res, 400, 'tourId and departure are required');
        const r = cases.prepareCases({ tourId: b.tourId, departure: b.departure, kind: b.kind || 'warning', who, ctx: await riskCtx() });
        return ok({ created: r.created.length, existing: r.existing.length, cases: [...r.created, ...r.existing].map(c => c.id), previews: [...r.created, ...r.existing].slice(0, 3).map(c => cases.preview(c)) });
      }
      if (M === 'POST' && seg[1] === 'send') {
        const b = await json(req), out = [];
        for (const id of b.ids || []) { try { out.push({ id, ok: true, messages: (await cases.sendCase(id, who)).map(m => ({ channel: m.channel, status: m.status, error: m.error })) }); } catch (e) { out.push({ id, ok: false, error: e.message }); } }
        return ok({ mode: messagingMode(), results: out });
      }
      if (M === 'POST' && seg[2] === 'resolve') { const b = await json(req); try { const c = await cases.resolve(seg[1], b.action, b.note, who); return ok({ id: c.id, status: c.choice?.status ?? null }); } catch (e) { return bad(send, res, 400, e.message); } }
      return false;
    }
    case 'outbox': return M === 'GET' ? ok(listOutbox(+url.searchParams.get('limit') || 200)) : false;
    case 'messages': if (M === 'POST' && seg[1] === 'test') { const b = await json(req); if (!b.to || !['sms', 'email'].includes(b.channel)) return bad(send, res, 400, 'channel (sms|email) and to are required'); return ok({ mode: messagingMode(), results: await sendTest(b) }); } return false;
    case 'vouchers': return M === 'GET' ? ok(cases.listVouchers()) : false;
    case 'requests.csv': return M === 'GET' ? (send(res, 200, requestsCsv(), 'text/csv; charset=utf-8'), true) : false;
    case 'keys': {
      if (M === 'GET') return ok(listKeys());
      if (M === 'POST') { try { const k = createKey(await json(req)); cases.audit(who, 'key.create', { name: k.name, scopes: k.scopes }); return ok(k); } catch (e) { return bad(send, res, 400, e.message); } }
      if (M === 'DELETE' && seg[1]) { const r = revokeKey(seg[1]); cases.audit(who, 'key.revoke', { id: seg[1] }); return r ? ok() : bad(send, res, 404, 'no such key'); }
      return false;
    }
    case 'model': {
      if (M === 'GET') return ok({ model: loadModel(), report: evaluate(readIngest('outcomes', 1e6)), decisions: readIngest('outcomes', 1e6).length });
      if (M === 'POST' && seg[1] === 'train') { const r = await train(); resetRiskContext(); cases.audit(who, 'model.train', { samples: r.model.samples }); return ok({ model: r.model, enriched: r.enriched, skipped: r.skipped }); }
      return false;
    }
    case 'roads': { if (M !== 'GET') return false; try { return ok(await getRoads({ tours: readTours().tours })); } catch (e) { return bad(send, res, 502, e.message); } }
    case 'cameras': {
      if (M === 'GET' && !seg[1]) return ok(cams.readCameras().map(c => ({ ...c, authSet: !!(c.authEnv && process.env[c.authEnv]) })));
      if (M === 'PUT' && !seg[1]) { const r = cams.saveCameras((await json(req)).cameras || []); cases.audit(who, 'cameras.save', {}); return r.ok ? ok(r) : bad(send, res, 422, 'invalid cameras', { errors: r.errors }); }
      if (M === 'POST' && !seg[1]) { const r = cams.upsertCamera(await json(req)); cases.audit(who, 'cameras.upsert', {}); return r.ok ? ok(r) : bad(send, res, 422, 'invalid camera', { errors: r.errors }); }
      if (M === 'DELETE' && seg[1]) { const r = cams.removeCamera(decodeURIComponent(seg[1])); cases.audit(who, 'cameras.delete', { id: seg[1] }); return r.ok ? ok(r) : bad(send, res, 404, 'no such camera'); }
      if (M === 'POST' && seg[2] === 'test') {
        const cam = cams.readCameras().find(c => c.id === seg[1]); if (!cam) return bad(send, res, 404, 'no such camera');
        if (cam.type === 'page') return ok({ ok: true, note: 'Link only: opened in a new tab, nothing is fetched.' });
        const t0 = Date.now();
        try { const img = await cams.snapshot(cam.id, { fresh: true }); return ok({ ok: true, bytes: img.buf.length, type: img.type, ms: Date.now() - t0 }); }
        catch (e) { return ok({ ok: false, error: e.message }); }
      }
      return false;
    }
    case 'audit': return M === 'GET' ? ok(cases.listAudit(+url.searchParams.get('limit') || 200)) : false;
    case 'retention': if (M === 'POST' && seg[1] === 'run') { const r = purgeExpired(); cases.audit(who, 'retention.run', r); return ok(r); } return false;
    default: return false;
  }
}
export { resetRegistry };
