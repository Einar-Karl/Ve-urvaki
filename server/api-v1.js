// Public, versioned API for other software (booking systems, operator platforms, apps).
// Contract: docs/INTEGRATION.md and GET /api/v1/openapi.json. Breaking changes only in a new version (/api/v2).
//
// Conventions: JSON in/out · errors are RFC 9457 problem+json · every response carries X-Request-Id ·
// API keys (x-api-key or "Authorization: Bearer vv_…") are rate-limited (RateLimit-* headers) ·
// POST requests accept an Idempotency-Key header (replayed for 24 h) · times are ISO 8601 UTC (= Iceland time).
import crypto from 'node:crypto';
import { newId } from './lib/tokens.js';
import { col } from './lib/store.js';
import { REGIONS, nearestRegion, haversineKm } from './lib/regions.js';
import { readTours, TOUR_TYPES } from './lib/sites.js';
import { getForecast } from './services/forecast.js';
import { getObservations } from './services/observations.js';
import { getRoads } from './services/roads.js';
import { getGrid } from './services/grid.js';
import { makeRisk } from './services/risk.js';
import { getRiskContext } from './services/riskctx.js';
import { loadModel } from './services/model.js';
import { upcomingDepartures } from './services/departures.js';
import { publicList as camerasPublic } from './services/cameras.js';
import * as toursCfg from './services/toursconfig.js';
import { upsertGuests } from './services/guests.js';
import { append } from './services/ingest.js';
import * as wh from './services/webhooks.js';
import { spec } from './openapi.js';

const FL = { g: ['wind_gust', 'm/s'], p: ['precipitation', 'mm/h'], c: ['cloud_cover', '%'], s: ['wave_height', 'm'], t: ['temperature', '°C'] };
export const ICELAND = { latMin: 62.8, latMax: 67.3, lonMin: -25.5, lonMax: -12.5 };
const inIceland = (lat, lon) => lat >= ICELAND.latMin && lat <= ICELAND.latMax && lon >= ICELAND.lonMin && lon <= ICELAND.lonMax;

export class Problem extends Error { constructor(status, title, detail, extra = {}) { super(detail || title); Object.assign(this, { status, title, detail, extra }); } }
function sendProblem(res, rid, e) {
  res.writeHead(e.status, { 'Content-Type': 'application/problem+json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify({ type: 'about:blank', title: e.title, status: e.status, detail: e.detail, requestId: rid, ...e.extra }));
}
const num = (v, name) => { const n = Number(v); if (v == null || v === '' || !Number.isFinite(n)) throw new Problem(400, 'Invalid parameter', `${name} must be a number`); return n; };

// ---- per-key rate limit (fixed 1-minute window, per server instance) ----
const windows = new Map();
export function rateLimit(keyId, limit = Number(process.env.API_RATE_LIMIT || 120), now = Date.now()) {
  const slot = Math.floor(now / 60e3), w = windows.get(keyId);
  const cur = w && w.slot === slot ? w : { slot, n: 0 };
  cur.n++; windows.set(keyId, cur);
  return { limit, remaining: Math.max(0, limit - cur.n), reset: 60 - Math.floor((now % 60e3) / 1000), exceeded: cur.n > limit };
}

// ---- idempotency for POSTs (24 h) ----
const idem = () => col('idempotency');
function idemLookup(principal, key, body) {
  if (!key) return null;
  if (!/^[\w.:-]{8,128}$/.test(key)) throw new Problem(400, 'Invalid Idempotency-Key', 'use 8–128 characters: letters, digits, . : _ -');
  const id = crypto.createHash('sha256').update(`${principal}|${key}`).digest('hex'), hash = crypto.createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
  const hit = idem().get(id);
  if (hit && Date.now() - Date.parse(hit.at) < 86400e3) {
    if (hit.hash !== hash) throw new Problem(409, 'Idempotency-Key reused', 'this key was already used with a different request body');
    return { replay: hit };
  }
  return { save: (status, response) => idem().put({ id, hash, status, response, at: new Date().toISOString() }) };
}

// ---- conditions & risk for any point ----
async function conditions(lat, lon, hours) {
  const site = { pt: { lat, lon } };
  const fc = await getForecast({ sites: site });
  const region = nearestRegion({ lat, lon }, 400)?.id || 'rvk';
  const series = fc.regions.pt || fc.regions[region];
  const from = fc.nowHour, start = Date.parse(fc.start);
  const hourly = series.slice(from, from + hours).map((x, i) => ({
    time: new Date(start + (from + i) * 3600e3).toISOString(), windGust: x.g, wind: x.w, windDirection: x.dir, precipitation: x.p, cloudCover: x.c,
    temperature: x.t, visibilityKm: x.v ?? null, waveHeight: x.s || null, sourceSpread: x.sp ?? 0,
  }));
  let observation = null;
  try { const o = await getObservations({ sites: site }); observation = o.regions.pt || null; } catch { /* optional */ }
  const cameras = camerasPublic().filter(c => Number.isFinite(c.lat)).map(c => ({ ...c, distanceKm: Math.round(haversineKm({ lat, lon }, c)) })).filter(c => c.distanceKm <= 30).sort((a, b) => a.distanceKm - b.distanceKm);
  return {
    location: { lat, lon, region, regionName: REGIONS[region]?.name }, mode: fc.mode, forecastGeneratedAt: fc.generatedAt,
    pointForecast: !!fc.regions.pt, sources: (fc.sources || []).map(s => ({ id: s.id, label: s.label, ok: s.ok })),
    hourly, observation, cameras, attribution: [...new Set((fc.sources || []).filter(s => s.ok && s.attribution).map(s => s.attribution))],
  };
}

async function pointRisk(b) {
  if (b.tourId != null) {                                   // a configured tour: uses learned thresholds and road links
    const ctx = await getRiskContext(), dep = b.departure && new Date(b.departure).toISOString();
    if (!readTours().tours.some(t => String(t.id) === String(b.tourId))) throw new Problem(404, 'Unknown tour', `no tour with id ${b.tourId}`);
    if (!dep || dep === 'Invalid Date') throw new Problem(400, 'Invalid departure', 'departure must be an ISO date-time');
    const R = ctx.riskAt(b.tourId, dep);
    if (!R) throw new Problem(422, 'Outside forecast window', 'departure must be within the next ~72 hours');
    return shapeRisk(R, { tourId: b.tourId, departure: dep, mode: ctx.forecastMode, thresholds: 'tour (manual or learned)' });
  }
  if (!TOUR_TYPES.includes(b.activity)) throw new Problem(400, 'Invalid activity', `activity must be one of ${TOUR_TYPES.join(', ')}`);
  const lat = num(b.lat, 'lat'), lon = num(b.lon, 'lon');
  if (!inIceland(lat, lon)) throw new Problem(422, 'Outside coverage', 'only locations in Iceland are supported');
  const dur = b.durationHours == null ? 3 : num(b.durationHours, 'durationHours');
  if (dur <= 0 || dur > 12) throw new Problem(400, 'Invalid parameter', 'durationHours must be between 0 and 12');
  const startMs = Date.parse(b.start); if (!Number.isFinite(startMs)) throw new Problem(400, 'Invalid parameter', 'start must be an ISO date-time');
  const start = new Date(Math.floor(startMs / 3600e3) * 3600e3);
  const hh = `${String(start.getUTCHours()).padStart(2, '0')}:00`;
  const tour = { id: 'adhoc', name: 'adhoc', type: b.activity, lat, lon, region: nearestRegion({ lat, lon }, 400)?.id || 'rvk', departures: [hh], durationHours: dur, capacity: 1, priceISK: 0,
    ...(b.limits ? { limits: b.limits } : {}), ...(b.marine ? { marine: b.marine } : {}) };
  const sites = { 'tour:adhoc': { lat, lon, ...(b.marine ? { marine: b.marine } : {}) } };
  const forecast = await getForecast({ sites });
  const R = makeRisk({ forecast, tours: [tour] }).riskAt('adhoc', start.toISOString());
  if (!R) throw new Problem(422, 'Outside forecast window', 'start must be between now and ~72 hours ahead');
  return shapeRisk(R, { activity: b.activity, location: { lat, lon }, start: start.toISOString(), durationHours: dur, mode: forecast.mode, thresholds: b.limits ? 'custom limits' : 'activity defaults' });
}
const shapeRisk = (R, meta) => ({
  ...meta, status: R.status, probabilities: { go: round3(R.go), change: round3(R.change), cancel: round3(R.cancel) }, uncertainty: round3(R.unc),
  drivers: R.parts.map(p => ({ factor: FL[p.k]?.[0] || p.k, maxDuringTrip: p.v, unit: FL[p.k]?.[1] || '', riskStartsAt: p.lo, usuallyCancelledAt: p.hi, weight: round3(p.r) })),
  roadClosed: R.road || null, disclaimer: 'Decision support only. A person must make the final safety decision.',
});
const round3 = x => Math.round(x * 1000) / 1000;

const publicDeparture = d => ({ tourId: d.tourId, tourName: d.tourName, departure: d.departure, status: d.status, cancelProbability: d.cancel == null ? null : round3(d.cancel), roadClosed: d.road, reason: d.reason, decideBy: d.deadline, bookedPax: d.bookedPax, guestsOnFile: d.guests });

// ---------------------------------------------------------------- router
export async function v1Routes({ req, res, p, url, send, json }) {
  if (p !== '/api/v1' && !p.startsWith('/api/v1/')) return false;
  const rid = /^[\w-]{6,64}$/.test(req.headers['x-request-id'] || '') ? req.headers['x-request-id'] : newId('req_');
  res.setHeader('X-Request-Id', rid);
  const M = req.method, ok = (body, status = 200) => { send(res, status, body); return true; };
  try {
    if (req.auth?.role === 'key') {
      const rl = rateLimit(req.auth.keyId);
      res.setHeader('RateLimit-Limit', rl.limit); res.setHeader('RateLimit-Remaining', rl.remaining); res.setHeader('RateLimit-Reset', rl.reset);
      if (rl.exceeded) { res.setHeader('Retry-After', rl.reset); throw new Problem(429, 'Too many requests', `limit is ${rl.limit} requests per minute per key`); }
    }
    if ((p === '/api/v1' || p === '/api/v1/') && M === 'GET') return ok({ name: 'Veðurvaki API', version: '1', openapi: '/api/v1/openapi.json', docs: 'docs/INTEGRATION.md' });
    if (p === '/api/v1/openapi.json' && M === 'GET') return ok(spec());

    if (p === '/api/v1/conditions' && M === 'GET') {
      const lat = num(url.searchParams.get('lat'), 'lat'), lon = num(url.searchParams.get('lon'), 'lon');
      const hours = url.searchParams.has('hours') ? num(url.searchParams.get('hours'), 'hours') : 48;
      if (!inIceland(lat, lon)) throw new Problem(422, 'Outside coverage', 'only locations in Iceland are supported');
      if (hours < 1 || hours > 72) throw new Problem(400, 'Invalid parameter', 'hours must be between 1 and 72');
      return ok(await conditions(lat, lon, Math.round(hours)));
    }
    if (p === '/api/v1/risk' && M === 'POST') return ok(await pointRisk(await json(req)));
    if (p === '/api/v1/departures' && M === 'GET') {
      const days = url.searchParams.has('days') ? num(url.searchParams.get('days'), 'days') : 3;
      if (days < 1 || days > 3) throw new Problem(400, 'Invalid parameter', 'days must be 1, 2 or 3');
      const r = await upcomingDepartures({ days });
      return ok({ forecastMode: r.forecastMode, departures: r.departures.map(publicDeparture) });
    }
    if (p === '/api/v1/tours') {
      if (M === 'GET') { const { demo, tours, warnings } = readTours(); return ok({ demo, tours, warnings }); }
      if (M === 'PUT') {
        const b = await json(req), list = Array.isArray(b) ? b : b && b.tours ? b.tours : [b];
        const r = toursCfg.upsert(list);
        if (!r.ok) throw new Problem(422, 'Invalid tour data', 'see errors', { errors: r.errors });
        return ok(r);
      }
    }
    const ing = p.match(/^\/api\/v1\/(guests|bookings|outcomes|events)$/);
    if (ing && M === 'POST') {
      const b = await json(req);
      const im = idemLookup(req.auth?.who || 'anon', req.headers['idempotency-key'], b);
      if (im && im.replay) { res.setHeader('Idempotent-Replayed', 'true'); return ok(im.replay.response, im.replay.status); }
      const r = ing[1] === 'guests' ? upsertGuests(Array.isArray(b) ? b : [b]) : append(ing[1], b);
      if (!r.ok) throw new Problem(422, 'Invalid records', 'nothing was saved', { errors: r.errors });
      if (ing[1] === 'outcomes') for (const o of [].concat(b)) wh.emit('decision.recorded', { tourId: o.tourId, departure: o.departure, outcome: o.outcome, decidedBy: o.decidedBy || null });
      const resp = { ok: true, accepted: r.accepted };
      if (im && im.save) im.save(202, resp);
      return ok(resp, 202);
    }
    if (p === '/api/v1/cameras' && M === 'GET') return ok(camerasPublic());
    if (p === '/api/v1/roads' && M === 'GET') { const { sections, ...slim } = await getRoads({ tours: readTours().tours }); return ok(slim); }
    if (p === '/api/v1/grid' && M === 'GET') return ok(await getGrid());
    if (p === '/api/v1/model' && M === 'GET') return ok(loadModel());

    if (p.startsWith('/api/v1/webhooks')) {
      if (req.auth?.role === 'dashboard') throw new Problem(403, 'Forbidden', 'manage webhooks with an API key that has the "webhooks" scope, or in the admin page');
      const seg = p.split('/').slice(4);                    // ['', id, action]
      if (!seg[0] && M === 'GET') return ok(wh.listSubscriptions());
      if (!seg[0] && M === 'POST') { try { return ok(await wh.createSubscription(await json(req), req.auth?.who), 201); } catch (e) { throw new Problem(400, 'Invalid subscription', e.message); } }
      if (seg[0] && !seg[1] && M === 'DELETE') { if (!wh.deleteSubscription(seg[0])) throw new Problem(404, 'Not found', 'no such webhook'); return ok({ ok: true }); }
      if (seg[0] && seg[1] === 'test' && M === 'POST') { const r = await wh.sendTest(seg[0]); if (!r) throw new Problem(404, 'Not found', 'no such webhook'); return ok(r); }
      if (seg[0] && seg[1] === 'deliveries' && M === 'GET') return ok(wh.listDeliveries(seg[0]));
    }
    throw new Problem(404, 'Not found', `no ${M} ${p} in API v1`);
  } catch (e) {
    if (e instanceof Problem) { sendProblem(res, rid, e); return true; }
    if (e instanceof SyntaxError) { sendProblem(res, rid, new Problem(400, 'Invalid JSON', e.message)); return true; }
    if (e.code === 415) { sendProblem(res, rid, new Problem(415, 'Unsupported media type', e.message)); return true; }
    sendProblem(res, rid, new Problem(502, 'Upstream error', e.message)); return true;
  }
}
