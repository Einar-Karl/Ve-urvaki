// Tests for the production features: booking connector, learning, CSV import, auth, tour config.
// Provider response shapes are hand-built from documentation; see test/server.test.js header.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.INGEST_DIR = mkdtempSync(join(tmpdir(), 'vv2-')) + '/';
const { setFetch } = await import('../server/lib/http.js');
const { clearCache } = await import('../server/lib/cache.js');
const { default: bokun, sign, bokunDate, parseAvailabilities } = await import('../server/connectors/bokun.js');
const { latestSnapshots } = await import('../server/services/bookings.js');
const { fitLogistic, xAt, fitThresholds, buildSamples, maxGustInWindow } = await import('../server/services/model.js');
const { parseCsv, normalizeDeparture, toRecords } = await import('../scripts/import-csv.js');
const { validateTours, buildSites, readTours } = await import('../server/lib/sites.js');
const { createServer } = await import('../server/index.js');

const json = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });

test('Bókun: signature is HMAC-SHA1(secret, date+accessKey+METHOD+path) in base64; date format is UTC "yyyy-MM-dd HH:mm:ss"', () => {
  assert.equal(bokunDate(new Date('2026-10-12T09:05:07.999Z')), '2026-10-12 09:05:07');
  const sig = sign({ date: '2026-10-12 09:05:07', accessKey: 'AK', secret: 'SK', method: 'get', path: '/activity.json/1/availabilities?start=2026-10-12&end=2026-10-13' });
  const want = crypto.createHmac('sha1', 'SK').update('2026-10-12 09:05:07AKGET/activity.json/1/availabilities?start=2026-10-12&end=2026-10-13').digest('base64');
  assert.equal(sig, want);
});

test('Bókun: availability entries become departures with capacity = booked + remaining', () => {
  const tour = { id: 2, capacity: 64, departures: ['09:00'] };
  const d = parseAvailabilities([
    { date: Date.UTC(2026, 9, 12), startTime: '09:00', bookedParticipants: 48, availabilityCount: 16 },
    { date: Date.UTC(2026, 9, 12), startTime: '13:00', bookedParticipants: 10, unlimitedAvailability: true },
    { date: Date.UTC(2026, 9, 13), startTime: '09:00', availabilityCount: 20 },            // no booked field -> skipped, not invented
  ], tour);
  assert.equal(d.length, 2);
  assert.deepEqual(d[0], { tourId: 2, departure: '2026-10-12T09:00:00Z', pax: 48, capacity: 64, soldOut: false });
  assert.equal(d[1].capacity, 64);      // unlimited -> tour default
});

test('Bókun connector: sends the three auth headers and reports per-tour errors', async () => {
  process.env.BOKUN_ACCESS_KEY = 'AK'; process.env.BOKUN_SECRET_KEY = 'SK';
  const seen = [];
  setFetch(async (u, o) => {
    seen.push({ u: String(u), h: o.headers });
    if (String(u).includes('/activity.json/BAD/')) return json({}, 500);
    return json([{ date: Date.UTC(2026, 9, 12), startTime: '09:00', bookedParticipants: 5, availabilityCount: 5 }]);
  });
  const out = await bokun.bookings({ tours: [{ id: 1, bokunProductId: '111', capacity: 10, departures: ['09:00'] }, { id: 2, bokunProductId: 'BAD' }, { id: 3 }], start: '2026-10-12', end: '2026-10-13' });
  assert.equal(out.departures.length, 1); assert.equal(out.errors.length, 1); assert.equal(out.errors[0].tourId, 2);
  const h = seen[0].h;
  assert.equal(h['X-Bokun-AccessKey'], 'AK'); assert.match(h['X-Bokun-Date'], /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  const path = new URL(seen[0].u).pathname + new URL(seen[0].u).search;
  assert.equal(h['X-Bokun-Signature'], sign({ date: h['X-Bokun-Date'], accessKey: 'AK', secret: 'SK', method: 'GET', path }));
  assert.equal(seen.length, 2);          // tour 3 has no product id: not requested
  delete process.env.BOKUN_ACCESS_KEY; delete process.env.BOKUN_SECRET_KEY;
});

test('pushed booking snapshots: latest per departure wins, window respected', () => {
  const from = Date.parse('2026-10-12T00:00:00Z'), to = from + 4 * 86400e3;
  const s = latestSnapshots([
    { tourId: 2, departure: '2026-10-12T09:00:00Z', pax: 10 },
    { tourId: 2, departure: '2026-10-12T09:00:00Z', pax: 14, capacity: 64 },
    { tourId: 2, departure: '2026-11-01T09:00:00Z', pax: 99 },
  ], from, to);
  assert.equal(s.length, 1); assert.equal(s[0].pax, 14); assert.equal(s[0].capacity, 64);
});

// deterministic RNG so the test is reproducible
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

test('learning: recovers a known cancellation threshold from noisy decisions', () => {
  const r = rng(7), TRUE_P50 = 24, SLOPE = 0.6;
  const samples = Array.from({ length: 400 }, () => {
    const g = 8 + r() * 30;
    return { tourId: 2, g, cancelled: r() < 1 / (1 + Math.exp(-SLOPE * (g - TRUE_P50))) };
  });
  const fit = fitThresholds(samples)[2];
  assert.equal(fit.status, 'learned');
  assert.ok(Math.abs(fit.p50 - TRUE_P50) < 1.5, `p50 ${fit.p50} should be near ${TRUE_P50}`);
  assert.ok(fit.g[0] < fit.p50 && fit.p50 < fit.g[1]);
  const m = fitLogistic(samples.map(s => s.g), samples.map(s => +s.cancelled));
  assert.ok(Math.abs(xAt(m, 0.5) - TRUE_P50) < 1.5);
});

test('learning: keeps defaults when data is too thin or one-sided', () => {
  const few = Array.from({ length: 10 }, (_, i) => ({ tourId: 1, g: 10 + i, cancelled: i > 6 }));
  assert.equal(fitThresholds(few)[1].status, 'insufficient');
  const oneSided = Array.from({ length: 60 }, (_, i) => ({ tourId: 3, g: 5 + i % 20, cancelled: false }));
  assert.equal(fitThresholds(oneSided)[3].status, 'insufficient');
});

test('learning: demo-mode and "changed" records never become training samples', async () => {
  const tours = [{ id: 2, lat: 63.5, lon: -19.3, durationHours: 3 }];
  const { samples } = await buildSamples([
    { tourId: 2, departure: '2026-10-12T09:00:00Z', outcome: 'cancelled', mode: 'demo', snapshot: { g: 30 } },
    { tourId: 2, departure: '2026-10-12T09:00:00Z', outcome: 'changed', mode: 'live', snapshot: { g: 25 } },
    { tourId: 2, departure: '2026-10-12T09:00:00Z', outcome: 'cancelled', mode: 'live', snapshot: { g: 28 } },
    { tourId: 99, departure: '2026-10-12T09:00:00Z', outcome: 'ran', mode: 'live', snapshot: { g: 5 } },
  ], tours);
  assert.deepEqual(samples, [{ tourId: '2', g: 28, cancelled: true, source: 'snapshot' }]);
  assert.equal(maxGustInWindow({ '2026-10-12T09': { g: 10 }, '2026-10-12T10': { g: 22 }, '2026-10-12T13': { g: 40 } }, '2026-10-12T09:00:00Z', 3), 22);
});

test('CSV import: European Excel export (semicolons, comma decimals, dd.MM.yyyy) is normalised', () => {
  const rows = parseCsv('\ufefftourId;departure;pax;capacity\r\n2;14.02.2025 09:00;48,0;64\r\n');
  const [r] = toRecords('bookings', rows);
  assert.equal(r.tourId, 2); assert.equal(r.departure, '2025-02-14T09:00:00Z'); assert.equal(r.pax, 48);
  assert.equal(normalizeDeparture('2025-03-01 10:00'), '2025-03-01T10:00:00Z');
  assert.equal(parseCsv('a,b\n1,"x,y"')[0].b, 'x,y');
});

test('tour config: shipped template is valid; validator flags real mistakes', () => {
  const { tours, warnings, demo } = readTours();
  assert.equal(demo, true); assert.equal(tours.length, 12); assert.deepEqual(warnings, []);
  assert.ok(buildSites(tours)['tour:1'] && buildSites(tours).rvk);
  const w = validateTours([{ id: 1, name: 'A', type: 'zip', lat: 'x', lon: 1, departures: ['9am'], capacity: 0 }, { id: 1, name: 'B', type: 'hike', lat: 1, lon: 1, departures: ['09:00'], capacity: 5 }]);
  assert.ok(w.some(x => /unknown type/.test(x)) && w.some(x => /lat\/lon/.test(x)) && w.some(x => /departures/.test(x)) && w.some(x => /capacity/.test(x)) && w.some(x => /duplicate/.test(x)));
});

async function withServer(fn) {
  const srv = createServer(); await new Promise(r => srv.listen(0, r));
  try { await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

test('auth: with DASHBOARD_PASSWORD everything is locked except /healthz and token-authenticated ingest', async () => {
  process.env.DASHBOARD_PASSWORD = 's3cret'; process.env.INGEST_TOKEN = 'tok';
  const basic = (u, p) => ({ Authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });
  try {
    await withServer(async base => {
      assert.equal((await fetch(`${base}/healthz`)).status, 200);
      const noAuth = await fetch(`${base}/`);
      assert.equal(noAuth.status, 401); assert.match(noAuth.headers.get('www-authenticate'), /Basic/);
      assert.equal((await fetch(`${base}/api/tours`)).status, 401);
      assert.equal((await fetch(`${base}/`, { headers: basic('arctic', 'wrong') })).status, 401);
      assert.equal((await fetch(`${base}/`, { headers: basic('arctic', 's3cret') })).status, 200);
      const rec = { tourId: 2, departure: '2026-10-12T09:00:00Z', outcome: 'ran' };
      assert.equal((await fetch(`${base}/api/ingest/outcomes`, { method: 'POST', body: JSON.stringify(rec), headers: { 'x-api-key': 'tok' } })).status, 202);
      const asJson = h => ({ ...h, 'content-type': 'application/json' });
      assert.equal((await fetch(`${base}/api/ingest/outcomes`, { method: 'POST', body: JSON.stringify(rec), headers: asJson(basic('arctic', 's3cret')) })).status, 202);
      // CSRF guard: a browser session posting anything but JSON (what a cross-site form can send) is refused
      assert.equal((await fetch(`${base}/api/ingest/outcomes`, { method: 'POST', body: JSON.stringify(rec), headers: { ...basic('arctic', 's3cret'), 'content-type': 'text/plain' } })).status, 415);
      assert.equal((await fetch(`${base}/api/ingest/outcomes`, { method: 'POST', body: JSON.stringify(rec), headers: { 'x-api-key': 'nope' } })).status, 401);
      assert.equal((await fetch(`${base}/api/tours`, { headers: { 'x-api-key': 'tok' } })).status, 401); // token only opens ingest
    });
  } finally { delete process.env.DASHBOARD_PASSWORD; delete process.env.INGEST_TOKEN; }
});

test('server: /api/tours, /api/model and /api/bookings (none configured) respond sensibly', async () => {
  clearCache();
  await withServer(async base => {
    const t = await (await fetch(`${base}/api/tours`)).json();
    assert.equal(t.tours.length, 12); assert.deepEqual(t.warnings, []);
    assert.deepEqual((await (await fetch(`${base}/api/model`)).json()).tours, {});
    const b = await (await fetch(`${base}/api/bookings`)).json();
    assert.equal(b.mode, 'none');
    assert.equal((await fetch(`${base}/`)).headers.get('x-frame-options'), 'DENY');
  });
});

test('server: pushed booking snapshots are served as mode "ingested"', async () => {
  clearCache();
  const day = new Date().toISOString().slice(0, 10);
  await withServer(async base => {
    await fetch(`${base}/api/ingest/bookings`, { method: 'POST', body: JSON.stringify({ tourId: 2, departure: `${day}T13:00:00Z`, pax: 33, capacity: 64 }) });
    const b = await (await fetch(`${base}/api/bookings`)).json();
    assert.equal(b.mode, 'ingested'); assert.equal(b.departures[0].pax, 33);
  });
});

test('tour limits: validated; evaluation report counts agreement, misses and calibration', async () => {
  assert.deepEqual(validateTours([{ id: 1, name: 'A', type: 'hike', lat: 1, lon: 1, departures: ['09:00'], capacity: 5, limits: { g: [16, 27] } }]), []);
  assert.ok(validateTours([{ id: 1, name: 'A', type: 'hike', lat: 1, lon: 1, departures: ['09:00'], capacity: 5, limits: { g: [30, 20], x: [1, 2] } }]).some(x => /limits/.test(x)));
  const { evaluate } = await import('../server/services/model.js');
  const rec = (p, outcome, mode = 'live') => ({ mode, outcome, snapshot: { cancelProb: p } });
  const ev = evaluate([rec(0.9, 'cancelled'), rec(0.7, 'ran'), rec(0.1, 'ran'), rec(0.3, 'cancelled'), rec(0.95, 'cancelled', 'demo'), rec(0.5, 'changed')]);
  assert.equal(ev.n, 4); assert.equal(ev.agreement, 0.5); assert.equal(ev.missedCancellations, 1); assert.equal(ev.falseAlarms, 1);
  assert.equal(ev.calibration[4].n, 1); assert.equal(ev.calibration[4].observed, 1);   // 0.9 bucket: 1 of 1 cancelled
});
