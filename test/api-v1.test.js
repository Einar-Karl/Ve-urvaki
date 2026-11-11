// Public API v1 and webhooks: scopes, problem+json, idempotency, rate limits, signing, retries, SSRF, risk watcher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'vv6-'));
Object.assign(process.env, { STORE_DIR: `${tmp}/store/`, INGEST_DIR: `${tmp}/ingest/`, SETTINGS_FILE: `${tmp}/s.json`, POLICY_FILE: `${tmp}/p.json`, TOURS_FILE: `${tmp}/t.json`, MODEL_FILE: `${tmp}/m.json`, CAMERAS_FILE: `${tmp}/c.json`, DATA_MODE: 'demo' });
for (const k of ['DASHBOARD_PASSWORD', 'ADMIN_PASSWORD', 'INGEST_TOKEN', 'VERCEL', 'API_RATE_LIMIT']) delete process.env[k];
copyFileSync(new URL('../config/tours.json', import.meta.url), process.env.TOURS_FILE);

const { setFetch } = await import('../server/lib/http.js');
const { createKey } = await import('../server/services/keys.js');
const { scopeFor } = await import('../server/lib/auth.js');
const cams = await import('../server/services/cameras.js');
const wh = await import('../server/services/webhooks.js');
const { checkRisk } = await import('../server/services/watcher.js');
const { rateLimit } = await import('../server/api-v1.js');
const { spec } = await import('../server/openapi.js');
const { createServer } = await import('../server/index.js');
const { col } = await import('../server/lib/store.js');

cams.resolver.lookup = async h => [{ address: h.startsWith('internal') ? '10.0.0.7' : '93.184.216.34' }];
setFetch(async () => { throw new Error('blocked'); });
const keyRead = createKey({ name: 'reader', scopes: ['read'] }).key;
const keyIngest = createKey({ name: 'ingester', scopes: ['ingest'] }).key;
const keyHooks = createKey({ name: 'hooks', scopes: ['webhooks'] }).key;
const J = { 'content-type': 'application/json' };

async function server(fn) { const s = createServer(); await new Promise(r => s.listen(0, r)); try { await fn(`http://127.0.0.1:${s.address().port}`); } finally { s.close(); } }
const at = (h, d = 0) => { const x = new Date(); x.setUTCHours(h, 0, 0, 0); return new Date(x.getTime() + d * 86400e3).toISOString(); };

test('scopes: each endpoint needs the smallest matching permission', () => {
  assert.equal(scopeFor('GET', '/api/v1/conditions'), 'read'); assert.equal(scopeFor('POST', '/api/v1/risk'), 'read');
  assert.equal(scopeFor('POST', '/api/v1/guests'), 'ingest'); assert.equal(scopeFor('GET', '/api/v1/tours'), 'read');
  assert.equal(scopeFor('PUT', '/api/v1/tours'), 'tours'); assert.equal(scopeFor('POST', '/api/v1/webhooks'), 'webhooks');
  assert.equal(scopeFor('GET', '/api/admin/overview'), null);
});

test('discovery is public; every OpenAPI path is answered by the server', async () => {
  await server(async base => {
    assert.equal((await fetch(`${base}/api/v1`)).status, 200);
    const s = await (await fetch(`${base}/api/v1/openapi.json`)).json();
    assert.equal(s.openapi, '3.1.0'); assert.deepEqual(Object.keys(s.paths), Object.keys(spec().paths));
    const keyFor = sc => sc === 'webhooks' ? keyHooks : sc === 'ingest' ? keyIngest : keyRead;
    for (const [path, ops] of Object.entries(s.paths)) for (const [method, op] of Object.entries(ops)) {
      const scope = op.security[0].ApiKey[0];
      const r = await fetch(`${base}/api/v1${path.replace('{id}', 'wh_missing')}`, { method: method.toUpperCase(), headers: { 'x-api-key': keyFor(scope), ...J }, ...(method === 'get' || method === 'delete' ? {} : { body: '{}' }) });
      const b = await r.text();
      assert.ok(!/in API v1/.test(b), `${method.toUpperCase()} ${path} is in the spec but not routed (${r.status} ${b.slice(0, 120)})`);
    }
  });
});

test('conditions and risk for any point in Iceland; clear problem+json errors', async () => {
  await server(async base => {
    const H = { 'x-api-key': keyRead, 'x-request-id': 'test-req-123' };
    const c = await fetch(`${base}/api/v1/conditions?lat=63.53&lon=-19.35&hours=24`, { headers: H });
    assert.equal(c.status, 200); assert.equal(c.headers.get('x-request-id'), 'test-req-123');
    const cj = await c.json(); assert.equal(cj.hourly.length, 24); assert.equal(cj.mode, 'demo'); assert.ok('visibilityKm' in cj.hourly[0]);
    const out = await fetch(`${base}/api/v1/conditions?lat=51.5&lon=-0.1`, { headers: H });
    assert.equal(out.status, 422); assert.match(out.headers.get('content-type'), /problem\+json/); assert.equal((await out.json()).title, 'Outside coverage');
    assert.equal((await fetch(`${base}/api/v1/conditions?lat=abc&lon=1`, { headers: H })).status, 400);

    const start = new Date(Date.now() + 3 * 3600e3).toISOString();
    const r = await (await fetch(`${base}/api/v1/risk`, { method: 'POST', headers: { ...H, ...J }, body: JSON.stringify({ activity: 'hike', lat: 63.53, lon: -19.35, start, durationHours: 3 }) })).json();
    const sum = r.probabilities.go + r.probabilities.change + r.probabilities.cancel;
    assert.ok(Math.abs(sum - 1) < 0.01); assert.ok(['go', 'change', 'cancel'].includes(r.status)); assert.ok(r.drivers.length >= 1); assert.match(r.disclaimer, /person/);
    const custom = await (await fetch(`${base}/api/v1/risk`, { method: 'POST', headers: { ...H, ...J }, body: JSON.stringify({ activity: 'hike', lat: 63.53, lon: -19.35, start, limits: { g: [1, 2] } }) })).json();
    assert.ok(custom.probabilities.cancel >= r.probabilities.cancel); assert.equal(custom.thresholds, 'custom limits');   // stricter own limits → more risk
    const tour = await (await fetch(`${base}/api/v1/risk`, { method: 'POST', headers: { ...H, ...J }, body: JSON.stringify({ tourId: 2, departure: at(9, 1) }) })).json();
    assert.ok(tour.probabilities); assert.equal(tour.tourId, 2);
    assert.equal((await fetch(`${base}/api/v1/risk`, { method: 'POST', headers: { ...H, ...J }, body: JSON.stringify({ activity: 'skydiving', lat: 64, lon: -21, start }) })).status, 400);
    assert.equal((await fetch(`${base}/api/v1/risk`, { method: 'POST', headers: { ...H, ...J }, body: JSON.stringify({ activity: 'hike', lat: 64, lon: -21, start: at(9, 10) }) })).status, 422);
    const deps = await (await fetch(`${base}/api/v1/departures?days=1`, { headers: H })).json();
    assert.ok(Array.isArray(deps.departures)); assert.ok(!JSON.stringify(deps).includes('@'), 'no guest contact data in departures');
  });
});

test('keys only do what their scope allows; Bearer form works', async () => {
  await server(async base => {
    const g = JSON.stringify({ ref: 'X-1', tourId: 2, departure: at(9, 1), pax: 2, email: 'a@example.com' });
    assert.equal((await fetch(`${base}/api/v1/guests`, { method: 'POST', headers: { 'x-api-key': keyRead, ...J }, body: g })).status, 403);
    assert.equal((await fetch(`${base}/api/v1/guests`, { method: 'POST', headers: { Authorization: `Bearer ${keyIngest}`, ...J }, body: g })).status, 202);
    assert.equal((await fetch(`${base}/api/v1/conditions?lat=64&lon=-21`, { headers: { 'x-api-key': keyIngest } })).status, 403);
    assert.equal((await fetch(`${base}/api/v1/webhooks`, { headers: { 'x-api-key': keyRead } })).status, 403);
    assert.equal((await fetch(`${base}/api/v1/conditions?lat=64&lon=-21`, { headers: { 'x-api-key': 'vv_not_a_key' } })).status, 401);
  });
});

test('idempotency: a retried POST is replayed, a reused key with a different body is refused', async () => {
  await server(async base => {
    const H = { 'x-api-key': keyIngest, 'Idempotency-Key': 'booking-sync-0001', ...J };
    const body = JSON.stringify({ tourId: 2, departure: at(9, 1), pax: 40, capacity: 64 });
    const a = await fetch(`${base}/api/v1/bookings`, { method: 'POST', headers: H, body });
    const b = await fetch(`${base}/api/v1/bookings`, { method: 'POST', headers: H, body });
    assert.equal(a.status, 202); assert.equal(b.status, 202); assert.equal(b.headers.get('idempotent-replayed'), 'true');
    assert.equal((await fetch(`${base}/api/v1/bookings`, { method: 'POST', headers: H, body: JSON.stringify({ tourId: 2, departure: at(9, 1), pax: 1 }) })).status, 409);
  });
});

test('rate limit per key with standard headers', async () => {
  const t0 = 60e3 * 1000;
  for (let i = 0; i < 3; i++) assert.equal(rateLimit('k', 3, t0 + i).exceeded, false);
  assert.equal(rateLimit('k', 3, t0 + 5).exceeded, true);
  assert.equal(rateLimit('k', 3, t0 + 60e3).exceeded, false);           // next minute
  process.env.API_RATE_LIMIT = '2';
  const k = createKey({ name: 'tiny', scopes: ['read'] }).key;
  await server(async base => {
    const go = () => fetch(`${base}/api/v1/cameras`, { headers: { 'x-api-key': k } });
    const r1 = await go(); assert.equal(r1.headers.get('ratelimit-limit'), '2'); await go();
    const r3 = await go(); assert.equal(r3.status, 429); assert.ok(r3.headers.get('retry-after'));
  });
  delete process.env.API_RATE_LIMIT;
});

test('webhooks: https + public only, secret shown once, signed deliveries, retries then failure', async () => {
  await assert.rejects(() => wh.createSubscription({ url: 'http://hooks.partner.example/x' }), /https/);
  await assert.rejects(() => wh.createSubscription({ url: 'https://internal.partner.example/x' }), /private/);
  await assert.rejects(() => wh.createSubscription({ url: 'https://hooks.partner.example/x', events: ['nope'] }), /events/);
  const sub = await wh.createSubscription({ url: 'https://hooks.partner.example/x', events: ['guest.choice_made'] });
  assert.match(sub.secret, /^whsec_/);
  assert.ok(wh.listSubscriptions().every(s => !s.secret));
  const got = [];
  setFetch(async (u, o) => { got.push({ u: String(u), o }); return { ok: true, status: 200, headers: { get: () => null } }; });
  await wh.emit('departure.risk_changed', { x: 1 });                                // not subscribed → not sent
  await wh.emit('guest.choice_made', { bookingRef: 'AB-1' });
  assert.equal(got.length, 1);
  const { o } = got[0], body = o.body;
  assert.equal(o.headers['X-Vedurvaki-Event'], 'guest.choice_made');
  assert.equal(wh.verify(sub.secret, o.headers['X-Vedurvaki-Signature'], body), true);
  assert.equal(wh.verify(sub.secret, o.headers['X-Vedurvaki-Signature'], body.replace('AB-1', 'AB-2')), false);   // tampered body
  assert.equal(wh.verify(sub.secret, o.headers['X-Vedurvaki-Signature'], body, { now: Date.now() + 10 * 60e3 }), false);   // replay window
  assert.equal(JSON.parse(body).data.bookingRef, 'AB-1');
  setFetch(async () => ({ ok: false, status: 500, headers: { get: () => null } }));
  await wh.emit('guest.choice_made', { bookingRef: 'AB-2' });
  let d = col('webhook_deliveries').find(x => x.body.includes('AB-2'))[0];
  assert.equal(d.status, 'retrying'); assert.equal(d.attempts, 1); assert.ok(d.nextAt > Date.now());
  for (let i = 0; i < 6; i++) await wh.processDue(Date.now() + 365 * 86400e3);
  d = col('webhook_deliveries').get(d.id);
  assert.equal(d.status, 'failed'); assert.equal(d.attempts, 6);
  setFetch(async () => { throw new Error('blocked'); });
});

test('risk watcher: emits departure.risk_changed and departure.road_blocked only on real changes', async () => {
  const sub = await wh.createSubscription({ url: 'https://hooks.partner.example/risk', events: ['departure.risk_changed', 'departure.road_blocked'] });
  const seen = [];
  setFetch(async (u, o) => { if (String(u).endsWith('/risk')) seen.push(JSON.parse(o.body)); return { ok: true, status: 200, headers: { get: () => null } }; });
  const dep = (cancel, status, road = null) => [{ tourId: 2, tourName: 'Glacier', departure: at(9, 1), cancel, status, road, deadline: at(18), reason: { code: 'wind' }, bookedPax: 10, guests: 1 }];
  await checkRisk({ list: dep(0.1, 'go') }); await new Promise(r => setTimeout(r, 20));
  assert.equal(seen.length, 0, 'first observation only records state');
  await checkRisk({ list: dep(0.15, 'go') }); await new Promise(r => setTimeout(r, 20));
  assert.equal(seen.length, 0, 'small change, same status: no event');
  await checkRisk({ list: dep(0.7, 'cancel', ['Þórsmerkurvegur']) }); await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(seen.map(e => e.type).sort(), ['departure.risk_changed', 'departure.road_blocked']);
  assert.equal(seen.find(e => e.type === 'departure.risk_changed').data.previous.status, 'go');
  wh.deleteSubscription(sub.id); setFetch(async () => { throw new Error('blocked'); });
});

test('grid: demo mode has no points (map falls back), live maps Open-Meteo multi-location output', async () => {
  const { getGrid, gridPoints } = await import('../server/services/grid.js');
  assert.equal((await getGrid({ mode: 'demo' })).points.length, 0);
  const n = gridPoints().length; assert.ok(n > 50 && n < 200);
  const day = new Date(); day.setUTCHours(0, 0, 0, 0);
  setFetch(async () => ({ ok: true, status: 200, json: async () => gridPoints().map(() => ({ hourly: { time: Array.from({ length: 96 }, (_, i) => new Date(day.getTime() + i * 3600e3).toISOString().slice(0, 16)), wind_gusts_10m: Array(96).fill(12), wind_speed_10m: Array(96).fill(7), wind_direction_10m: Array(96).fill(200) } })) }));
  const g = await getGrid({ mode: 'auto' });
  assert.equal(g.mode, 'live'); assert.equal(g.points.length, n); assert.equal(g.points[0].g[5], 12);
  setFetch(async () => { throw new Error('blocked'); });
});

test('map: Mapbox with a public token, secret tokens refused, OSM fallback with a warning', async () => {
  const { mapConfig, DEFAULTS } = await import('../server/lib/settings.js');
  const s = { map: { ...DEFAULTS.map } };
  const mb = mapConfig(s, { MAPBOX_TOKEN: 'pk.eyJ1IjoidGVzdCJ9.abc' });
  assert.equal(mb.provider, 'mapbox'); assert.equal(mb.tileSize, 512); assert.equal(mb.zoomOffset, -1);
  assert.match(mb.tilesUrl, /^https:\/\/api\.mapbox\.com\/styles\/v1\/mapbox\/outdoors-v12\/tiles\/512\/\{z\}\/\{x\}\/\{y\}@2x\?access_token=pk\./);
  assert.match(mb.attribution, /Mapbox/); assert.match(mb.attribution, /OpenStreetMap/);
  const sk = mapConfig(s, { MAPBOX_TOKEN: 'sk.secret' });
  assert.equal(sk.disabled, true); assert.ok(!JSON.stringify(sk).includes('sk.secret'), 'a secret token never reaches the browser');
  const none = mapConfig(s, {}); assert.equal(none.provider, 'osm'); assert.match(none.warning, /MAPBOX_TOKEN/);
  assert.equal(mapConfig({ map: { ...DEFAULTS.map, provider: 'mapbox', style: 'mapbox/satellite-streets-v12' } }, { MAPBOX_TOKEN: 'pk.x' }).style, 'mapbox/satellite-streets-v12');
  const { saveSettings } = await import('../server/lib/settings.js');
  assert.throws(() => saveSettings({ map: { style: 'bad style' } }), /style/);
  assert.throws(() => saveSettings({ map: { provider: 'google' } }), /provider/);
  await server(async base => { const j = await (await fetch(`${base}/api/map`)).json(); assert.ok(j.tilesUrl); });
});
