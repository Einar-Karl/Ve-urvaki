// Vercel deployment support: runtime paths, mandatory password, pre-parsed request bodies, entry point.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'vv5-'));
const { prepareRuntime } = await import('../server/lib/vercel-runtime.js');

test('prepareRuntime: does nothing off Vercel; on Vercel points writable paths at /tmp and seeds config', () => {
  assert.equal(prepareRuntime({ env: {}, tmp }), false);
  const root = join(tmp, 'repo'); mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config', 'tours.json'), '{"demo":true,"tours":[]}');
  const env = { VERCEL: '1', POLICY_FILE: '/custom/policy.json' };
  assert.equal(prepareRuntime({ env, root, tmp: join(tmp, 'run') }), true);
  assert.equal(env.STORE_DIR, join(tmp, 'run', 'store') + '/');
  assert.equal(env.INGEST_DIR, join(tmp, 'run', 'ingest') + '/');
  assert.equal(env.TOURS_FILE, join(tmp, 'run', 'config', 'tours.json'));
  assert.equal(readFileSync(env.TOURS_FILE, 'utf8'), '{"demo":true,"tours":[]}');       // seeded from the repo
  assert.equal(env.POLICY_FILE, '/custom/policy.json');                                  // explicit settings are respected
  assert.equal(existsSync(env.SETTINGS_FILE), false);                                    // missing files stay missing: defaults apply
  writeFileSync(env.TOURS_FILE, '{"demo":false,"tours":[]}');
  prepareRuntime({ env: { VERCEL: '1' }, root, tmp: join(tmp, 'run') });
  assert.equal(readFileSync(join(tmp, 'run', 'config', 'tours.json'), 'utf8'), '{"demo":false,"tours":[]}');  // a warm instance keeps its edits
});

test('api/index.js: the real Vercel entry point works as a Node request handler, locked until a password exists', async () => {
  Object.assign(process.env, { VERCEL: '1', DATA_MODE: 'demo', STORE_DIR: `${tmp}/e/store/`, INGEST_DIR: `${tmp}/e/ingest/`, SETTINGS_FILE: `${tmp}/e/s.json`, POLICY_FILE: `${tmp}/e/p.json`, TOURS_FILE: `${tmp}/e/t.json`, MODEL_FILE: `${tmp}/e/m.json`, CAMERAS_FILE: `${tmp}/e/c.json` });
  mkdirSync(`${tmp}/e`, { recursive: true }); writeFileSync(process.env.TOURS_FILE, readFileSync(new URL('../config/tours.json', import.meta.url)));
  delete process.env.DASHBOARD_PASSWORD; delete process.env.ADMIN_PASSWORD;
  const { default: handler } = await import('../api/index.js');
  const srv = http.createServer(handler); await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    const locked = await fetch(`${base}/`); assert.equal(locked.status, 503); assert.match((await locked.json()).error, /DASHBOARD_PASSWORD/);
    assert.equal((await fetch(`${base}/api/admin/overview`)).status, 503);                // admin is never left open on the internet
    assert.equal((await fetch(`${base}/g/not-a-real-token`)).status, 200);                // guest pages stay reachable (token-protected)
    assert.equal((await fetch(`${base}/api/guest/not-a-real-token`)).status, 404);
    process.env.DASHBOARD_PASSWORD = 'pw';
    const b = { Authorization: 'Basic ' + Buffer.from('arctic:pw').toString('base64') };
    assert.equal((await fetch(`${base}/`, { headers: b })).status, 200);
    const ov = await (await fetch(`${base}/api/admin/overview`, { headers: b })).json(); assert.equal(ov.ephemeralStorage, true);
  } finally { srv.close(); delete process.env.DASHBOARD_PASSWORD; delete process.env.VERCEL; }
});

test('a body that the platform already parsed (req.body) is used instead of the exhausted stream', async () => {
  const { handler } = await import('../server/index.js');
  Object.assign(process.env, { DASHBOARD_PASSWORD: 'pw' });
  const srv = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {            // simulate Vercel: stream consumed, parsed body exposed
      req.body = JSON.parse(Buffer.concat(chunks).toString() || 'null'); req.removeAllListeners('data');
      const orig = req[Symbol.asyncIterator].bind(req); req[Symbol.asyncIterator] = () => ({ next: async () => ({ done: true }) }); void orig;
      handler(req, res);
    });
  });
  await new Promise(r => srv.listen(0, r));
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/ingest/events`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from('arctic:pw').toString('base64'), 'content-type': 'application/json' }, body: JSON.stringify({ note: 'hello' }) });
    assert.equal(r.status, 202);
  } finally { srv.close(); delete process.env.DASHBOARD_PASSWORD; }
});
