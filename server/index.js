// Veðurvaki server: serves the dashboard and a small JSON API over the connectors.
//   GET  /api/forecast?mode=auto|live|demo   fused 96 h forecast per region
//   GET  /api/history?mode=…                 30 days of observed/reanalysed gust + rain
//   GET  /api/observations                   latest IMO station readings matched to regions
//   GET  /api/aurora                         NOAA Kp series
//   GET  /api/roads                          Vegagerðin road situations (if configured)
//   GET  /api/health                         per-connector status (?force=1 to bypass cache)
//   GET  /api/tours                          tour configuration (config/tours.json)
//   GET  /api/bookings                       departures with booked seats (Bókun → pushed snapshots → none)
//   GET  /api/model                          learned per-tour thresholds (config/thresholds.json)
//   GET  /healthz                            liveness probe (never requires auth)
//   POST /api/ingest/:kind  GET /api/ingest/:kind  GET /api/ingest/:kind.csv
// Auth: set DASHBOARD_PASSWORD to require HTTP Basic auth (user DASHBOARD_USER, default "arctic").
// /api/ingest/* additionally accepts the x-api-key header matching INGEST_TOKEN, for other programs.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';
import { memo } from './lib/cache.js';
import { loadConnectors, withKind } from './registry.js';
import { getForecast } from './services/forecast.js';
import { getHistory } from './services/history.js';
import { checkAll } from './services/health.js';
import { append, read, toCsvEU, KINDS } from './services/ingest.js';
import { getBookings } from './services/bookings.js';
import { getRoads } from './services/roads.js';
import { getObservations } from './services/observations.js';
import { loadModel } from './services/model.js';
import { readTours, buildSites, sitesSignature } from './lib/sites.js';
import { check as checkAuth } from './lib/auth.js';
import { scheduleNightly } from './services/train.js';
import { guestRoutes, partnerRoutes, adminRoutes } from './routes.js';
import { upsertGuests, scheduleRetention } from './services/guests.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = ['index.html', 'admin.html', 'guest.html', 'src', 'fixtures', 'docs'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };

const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SEC });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const fail = (res, e, code = 502) => send(res, code, { error: e.message });

async function firstOf(kind, ttl, arg) {
  const c = withKind(await loadConnectors(), kind)[0];
  if (!c) throw new Error(`no connector provides "${kind}"`);
  const sig = arg && arg.sites ? sitesSignature(arg.sites) : '';
  return memo(`${kind}:${c.id}:${sig}`, ttl, async () => ({ source: c.id, attribution: c.attribution, ...(await c[kind](arg)) }));
}

const siteSet = () => { const { demo, tours, warnings } = readTours(); return { demo, tours, warnings, sites: buildSites(tours) }; };
const roadsOff = { configured: false, records: [], byRegion: {} };

// Browser sessions (Basic auth is cached by the browser) must send application/json: a cross-site HTML form
// cannot, which blocks CSRF. API-key callers and local development are exempt.
const needsJson = req => req.auth && req.auth.who !== 'dev' && req.auth.role !== 'key' && req.auth.who !== 'public' && !['GET', 'HEAD'].includes(req.method);
class HttpError extends Error { constructor(m, code) { super(m); this.code = code; } }
async function jsonBody(req) {
  if (needsJson(req) && !String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError('Content-Type must be application/json', 415);
  return body(req);
}
async function body(req, limit = 1e6) {
  let n = 0; const chunks = [];
  for await (const c of req) { n += c.length; if (n > limit) throw new Error('payload too large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString() || 'null');
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname, mode = url.searchParams.get('mode') || process.env.DATA_MODE || 'auto';
    try {
      if (p === '/healthz') return send(res, 200, { ok: true, uptimeS: Math.round(process.uptime()) });
      const auth = checkAuth(req, p);
      if (!auth.ok) { res.setHeader('WWW-Authenticate', `Basic realm="${auth.realm}", charset="UTF-8"`); return send(res, 401, { error: auth.reason || 'authentication required' }); }
      req.auth = auth;
      const rctx = { req, res, p, url, send, json: jsonBody };
      if (await guestRoutes(rctx) || await partnerRoutes(rctx) || await adminRoutes(rctx)) return;
      if (p === '/admin') return send(res, 200, await readFile(join(ROOT, 'admin.html')), 'text/html; charset=utf-8');
      if (p === '/api/tours') { const { demo, tours, warnings } = siteSet(); return send(res, 200, { demo, tours, warnings }); }
      if (p === '/api/model') return send(res, 200, loadModel());
      if (p === '/api/bookings') return send(res, 200, await getBookings({ tours: siteSet().tours }));
      if (p === '/api/forecast') return send(res, 200, await getForecast({ mode, sites: siteSet().sites }));
      if (p === '/api/history') return send(res, 200, await getHistory({ mode, sites: siteSet().sites }));
      if (p === '/api/health') return send(res, 200, await checkAll({ force: url.searchParams.has('force') }));
      if (p === '/api/observations') return send(res, 200, await getObservations({ sites: siteSet().sites }));
      if (p === '/api/aurora') {
        const c = withKind(await loadConnectors(), 'aurora')[0];
        if (!c) throw new Error('no connector provides "aurora"');
        return send(res, 200, { source: c.id, attribution: c.attribution, series: await memo('aurora', 30 * 60e3, () => c.aurora()) });
      }
      if (p === '/api/roads') { const { sections, ...slim } = await getRoads({ tours: siteSet().tours }); return send(res, 200, slim); }
      const m = p.match(/^\/api\/ingest\/(\w+?)(\.csv)?$/);
      if (m && KINDS.includes(m[1])) {
        if (m[1] === 'guests') {
          if (req.method !== 'POST') return send(res, 405, { error: 'guest records are write-only here; read them in the admin page' });
          const b = await jsonBody(req); const r = upsertGuests(Array.isArray(b) ? b : [b]); return send(res, r.ok ? 202 : 422, r);
        }
        if (req.method === 'POST') { const r = append(m[1], await jsonBody(req)); return send(res, r.ok ? 202 : 422, r); }
        const rows = read(m[1], +url.searchParams.get('limit') || 100);
        return m[2] ? send(res, 200, toCsvEU(rows), 'text/csv; charset=utf-8') : send(res, 200, rows);
      }
      if (p.startsWith('/api/')) return send(res, 404, { error: 'unknown endpoint' });

      // static files, whitelisted to the front-end folders
      const rel = normalize(p === '/' ? 'index.html' : p.slice(1));
      if (rel.startsWith('..') || !PUBLIC.some(d => rel === d || rel.startsWith(d + '/'))) return send(res, 404, 'Not found', 'text/plain');
      send(res, 200, await readFile(join(ROOT, rel)), TYPES[extname(rel)] || 'application/octet-stream');
    } catch (e) {
      fail(res, e, e instanceof HttpError ? e.code : e instanceof SyntaxError ? 400 : 502);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 8080;
  createServer().listen(port, () => {
    console.log(`Veðurvaki → http://localhost:${port}  (DATA_MODE=${process.env.DATA_MODE || 'auto'})`);
    scheduleRetention();
    if (process.env.AUTO_TRAIN === '1') { scheduleNightly(); console.log('Nightly threshold training enabled (03:30 UTC).'); }
    if (process.env.MESSAGING_MODE !== 'live') console.log('Guest messaging is in DRY-RUN mode: messages are stored in the outbox, not sent (set MESSAGING_MODE=live).');
    if (!process.env.DASHBOARD_PASSWORD) console.warn('WARNING: DASHBOARD_PASSWORD is not set — the dashboard and API are open to anyone who can reach this port.');
  });
}
