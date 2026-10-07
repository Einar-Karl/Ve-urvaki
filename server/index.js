// Veðurvaki server: serves the dashboard and a small JSON API over the connectors.
//   GET  /api/forecast?mode=auto|live|demo   fused 96 h forecast per region
//   GET  /api/history?mode=…                 30 days of observed/reanalysed gust + rain
//   GET  /api/observations                   latest IMO station readings matched to regions
//   GET  /api/aurora                         NOAA Kp series
//   GET  /api/roads                          Vegagerðin road situations (if configured)
//   GET  /api/health                         per-connector status (?force=1 to bypass cache)
//   POST /api/ingest/:kind  GET /api/ingest/:kind  GET /api/ingest/:kind.csv
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

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = ['index.html', 'src', 'fixtures', 'docs'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const fail = (res, e, code = 502) => send(res, code, { error: e.message });

async function firstOf(kind, ttl) {
  const c = withKind(await loadConnectors(), kind)[0];
  if (!c) throw new Error(`no connector provides "${kind}"`);
  return memo(`${kind}:${c.id}`, ttl, async () => ({ source: c.id, attribution: c.attribution, ...(await c[kind]()) }));
}
const roadsOff = { configured: false, records: [], byRegion: {} };

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
      if (p === '/api/forecast') return send(res, 200, await getForecast({ mode }));
      if (p === '/api/history') return send(res, 200, await getHistory({ mode }));
      if (p === '/api/health') return send(res, 200, await checkAll({ force: url.searchParams.has('force') }));
      if (p === '/api/observations') return send(res, 200, await firstOf('observation', 5 * 60e3));
      if (p === '/api/aurora') {
        const c = withKind(await loadConnectors(), 'aurora')[0];
        if (!c) throw new Error('no connector provides "aurora"');
        return send(res, 200, { source: c.id, attribution: c.attribution, series: await memo('aurora', 30 * 60e3, () => c.aurora()) });
      }
      if (p === '/api/roads') {
        const c = withKind(await loadConnectors(), 'road')[0];
        return send(res, 200, c && c.configured() ? await memo('road', 2 * 60e3, () => c.road()) : roadsOff);
      }
      const m = p.match(/^\/api\/ingest\/(\w+?)(\.csv)?$/);
      if (m && KINDS.includes(m[1])) {
        if (process.env.INGEST_TOKEN && req.headers['x-api-key'] !== process.env.INGEST_TOKEN) return send(res, 401, { error: 'invalid or missing x-api-key' });
        if (req.method === 'POST') { const r = append(m[1], await body(req)); return send(res, r.ok ? 202 : 422, r); }
        const rows = read(m[1], +url.searchParams.get('limit') || 100);
        return m[2] ? send(res, 200, toCsvEU(rows), 'text/csv; charset=utf-8') : send(res, 200, rows);
      }
      if (p.startsWith('/api/')) return send(res, 404, { error: 'unknown endpoint' });

      // static files, whitelisted to the front-end folders
      const rel = normalize(p === '/' ? 'index.html' : p.slice(1));
      if (rel.startsWith('..') || !PUBLIC.some(d => rel === d || rel.startsWith(d + '/'))) return send(res, 404, 'Not found', 'text/plain');
      send(res, 200, await readFile(join(ROOT, rel)), TYPES[extname(rel)] || 'application/octet-stream');
    } catch (e) {
      fail(res, e, e instanceof SyntaxError ? 400 : 502);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 8080;
  createServer().listen(port, () => console.log(`Veðurvaki → http://localhost:${port}  (DATA_MODE=${process.env.DATA_MODE || 'auto'})`));
}
