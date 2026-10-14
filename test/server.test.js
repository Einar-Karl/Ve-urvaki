// Tests use hand-built response shapes that follow each provider's documented format.
// They verify OUR parsing, fusion, fallback and ingest logic. They do not prove the live services
// are reachable — use `npm run check` on a networked machine for that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.INGEST_DIR = mkdtempSync(join(tmpdir(), 'vv-')) + '/';
const { setFetch } = await import('../server/lib/http.js');
const { clearCache } = await import('../server/lib/cache.js');
const { default: omList } = await import('../server/connectors/openmeteo.js');
const openmeteo = omList[0];
const { parseTimeseries } = await import('../server/connectors/metno.js');
const { parseKp } = await import('../server/connectors/noaa.js');
const { normalizeRows, matchRegions } = await import('../server/connectors/imo.js');
const { parseDatex } = await import('../server/connectors/vegagerdin.js');
const { fuse } = await import('../server/services/forecast.js');
const { validate, toCsvEU } = await import('../server/services/ingest.js');
const { createServer } = await import('../server/index.js');
const { REGIONS } = await import('../server/lib/regions.js');

const json = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
const hours = n => Array.from({ length: n }, (_, i) => `2026-10-07T${String(i % 24).padStart(2, '0')}:00`);

test('Open-Meteo: multi-location response maps to region arrays keyed by hour', async () => {
  const ids = Object.keys(REGIONS);
  const one = { hourly: { time: hours(3), wind_gusts_10m: [10.04, 12, 14], wind_speed_10m: [6, 7, 8], wind_direction_10m: [200, 210, 220], precipitation: [0, 0.5, 1], cloud_cover: [50, 60, 70], temperature_2m: [5, 5, 4] } };
  let url;
  setFetch(async u => { url = u; return json(ids.map(() => one)); });
  const out = await openmeteo.forecast();
  assert.deepEqual(Object.keys(out), ids);
  assert.equal(out.rvk['2026-10-07T01'].g, 12);
  assert.equal(out.rvk['2026-10-07T00'].g, 10); // rounded to 1 decimal
  assert.match(url, /wind_speed_unit=ms/);
  assert.match(url, /timezone=GMT/);
});

test('Open-Meteo: single-location response (object, not array) also works', async () => {
  setFetch(async () => json({ hourly: { time: hours(2), wave_height: [1.1, 1.4] } }));
  const out = await openmeteo.marine();
  assert.ok(out.rvk);
});

test('MET Norway: holds values across coarse time steps and converts 6 h precipitation to mm/h', () => {
  const mk = (time, g, next) => ({ time, data: { instant: { details: { wind_speed_of_gust: g, wind_speed: g / 1.5, wind_from_direction: 180, cloud_area_fraction: 40, air_temperature: 3 } }, ...next } });
  const out = parseTimeseries([
    mk('2026-10-07T00:00:00Z', 10, { next_1_hours: { details: { precipitation_amount: 0.4 } } }),
    mk('2026-10-07T01:00:00Z', 12, { next_6_hours: { details: { precipitation_amount: 6 } } }),
    mk('2026-10-07T04:00:00Z', 20, {}),
  ]);
  assert.equal(out['2026-10-07T00'].p, 0.4);
  assert.equal(out['2026-10-07T03'].g, 12);   // held until the next entry
  assert.equal(out['2026-10-07T03'].p, 1);    // 6 mm / 6 h
  assert.equal(out['2026-10-07T04'].g, 20);
});

test('NOAA Kp: parses array-of-objects and legacy array-of-arrays', () => {
  const a = parseKp([{ time_tag: '2026-10-07T00:00:00', kp: 3.33, observed: 'predicted' }]);
  assert.equal(a[0].kp, 3.33); assert.equal(a[0].t, '2026-10-07T00:00:00.000Z');
  const b = parseKp([['time_tag', 'Kp', 'a_running'], ['2026-10-07 03:00:00.000', '2.67', '12']]);
  assert.equal(b[0].kp, 2.67); assert.equal(b[0].t, '2026-10-07T03:00:00.000Z');
});

test('IMO: tolerant field mapping, comma decimals, nearest-station matching and pinning', () => {
  const rows = normalizeRows([
    { station_id: 1, name: 'Reykjavík', lat: 64.127, lon: -21.9, wind_gust: '14,5', wind_speed: 9, wind_direction: 180, temperature: 6 },
    { stod: '5944', nafn: 'Sólheimajökull', location: { latitude: 63.53, longitude: -19.35 }, FG: 22 },
  ]);
  assert.equal(rows[0].g, 14.5);
  assert.equal(rows[1].lat, 63.53); assert.equal(rows[1].g, 22);
  const m = matchRegions(rows, { south: ['5944'] });
  assert.equal(m.rvk.station, '1'); assert.equal(m.rvk.g, 14.5);
  assert.equal(m.south.station, '5944');
  assert.equal(m.north, undefined);
});

test('Vegagerðin DATEX II: extracts situation records and flags closures', () => {
  const xml = `<d2:payload><sit:situation><sit:situationRecord xsi:type="sit:RoadOrCarriagewayOrLaneManagement" id="A1">
    <sit:validity><sit:validityTimeSpecification><sit:overallStartTime>2026-10-07T06:00:00Z</sit:overallStartTime></sit:validityTimeSpecification></sit:validity>
    <sit:generalPublicComment><sit:comment><com:values><com:value lang="is">Vegur lokaður</com:value></com:values></sit:comment></sit:generalPublicComment>
    <loc:pointCoordinates><loc:latitude>63.45</loc:latitude><loc:longitude>-19.0</loc:longitude></loc:pointCoordinates>
  </sit:situationRecord></sit:situation></d2:payload>`;
  const r = parseDatex(xml);
  assert.equal(r.length, 1); assert.equal(r[0].id, 'A1'); assert.equal(r[0].closed, true);
  assert.equal(r[0].lat, 63.45); assert.equal(r[0].start, '2026-10-07T06:00:00Z');
});

test('fusion: mean gust, spread between sources, hold-last on gaps, marine waves attached', () => {
  const keys = ['2026-10-07T00', '2026-10-07T01', '2026-10-07T02'];
  const a = { id: 'a', data: { rvk: { [keys[0]]: { g: 10, w: 6, dir: 200, p: 0, c: 50, t: 5 }, [keys[1]]: { g: 20, w: 12, dir: 210, p: 1, c: 60, t: 5 } } } };
  const b = { id: 'b', data: { rvk: { [keys[0]]: { g: 14, w: 8, dir: 190, p: 0.2, c: 40, t: 6 } } } };
  const f = fuse(keys, [a, b], { rvk: { [keys[0]]: { s: 1.5 } } }, ['rvk', 'hl']);
  assert.equal(f.rvk[0].g, 12); assert.equal(f.rvk[0].sp, 4); assert.equal(f.rvk[0].s, 1.5);
  assert.equal(f.rvk[1].g, 20); assert.equal(f.rvk[1].sp, 0);
  assert.equal(f.rvk[2].g, 20);          // gap -> held
  assert.equal(f.hl, undefined);         // no data for region -> omitted, not invented
});

test('ingest: validation and European CSV (semicolon separator, decimal comma)', () => {
  assert.equal(validate('outcomes', { tourId: 2, departure: '2026-10-07T09:00:00Z', outcome: 'ran' }), null);
  assert.match(validate('outcomes', { tourId: 2, departure: 'nope', outcome: 'ran' }), /ISO/);
  assert.match(validate('outcomes', { tourId: 2, departure: '2026-10-07T09:00:00Z', outcome: 'maybe' }), /outcome/);
  const csv = toCsvEU([{ tour: 'A;B', pax: 12.5, note: 'say "hi"' }]);
  assert.ok(csv.startsWith('﻿tour;pax;note'));
  assert.ok(csv.includes('"A;B";12,5;"say ""hi"""'));
});

async function withServer(fn) {
  const srv = createServer(); await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base); } finally { srv.close(); }
}

test('server: with every provider unreachable /api/forecast falls back to labelled demo data', async () => {
  clearCache();
  setFetch(async () => { throw new Error('blocked'); });
  await withServer(async base => {
    const j = await (await fetch(`${base}/api/forecast`)).json();
    assert.equal(j.mode, 'demo');
    assert.ok(j.demoReason);
    assert.equal(Object.keys(j.regions).length, Object.keys(REGIONS).length);
    assert.equal(j.regions.rvk.length, 96);
    const strict = await fetch(`${base}/api/forecast?mode=live`);
    assert.equal(strict.status, 502); // live mode never silently serves demo data
    const h = await (await fetch(`${base}/api/history`)).json();
    assert.equal(h.mode, 'demo'); assert.equal(h.regions.rvk.g.length, h.days * 24);
  });
});

test('server: fuses two live sources and reports per-source status', async () => {
  clearCache();
  const n = u => new URL(u).searchParams.get('latitude').split(',').length;
  const omHour = { hourly: { time: Array.from({ length: 96 }, (_, i) => new Date(new Date().setUTCHours(0, 0, 0, 0) + i * 3600e3).toISOString().slice(0, 16)), wind_gusts_10m: Array(96).fill(18), wind_speed_10m: Array(96).fill(11), wind_direction_10m: Array(96).fill(200), precipitation: Array(96).fill(0), cloud_cover: Array(96).fill(50), temperature_2m: Array(96).fill(4) } };
  setFetch(async u => {
    const url = String(u);
    if (url.includes('marine-api')) return json(Array.from({ length: n(url) }, () => ({ hourly: { time: omHour.hourly.time, wave_height: Array(96).fill(1.2) } })));
    if (url.includes('api.open-meteo.com')) return json(Array.from({ length: n(url) }, () => omHour));
    throw new Error('blocked'); // MET Norway down
  });
  await withServer(async base => {
    const j = await (await fetch(`${base}/api/forecast?mode=live`)).json();
    assert.equal(j.mode, 'live');
    assert.equal(j.regions.rvk[5].g, 18); assert.equal(j.regions.rvk[5].s, 1.2); assert.equal(j.regions.hl[5].s, 0);
    assert.ok(j.regions['tour:2'], 'each configured tour is forecast at its own point');
    assert.equal(j.regions['tour:2'].length, 96);
    const st = Object.fromEntries(j.sources.map(s => [s.id, s.ok]));
    assert.equal(st.openmeteo, true); assert.equal(st.metno, false);
  });
});

test('server: ingest accepts valid outcomes, rejects invalid ones, exports CSV', async () => {
  await withServer(async base => {
    const post = b => fetch(`${base}/api/ingest/outcomes`, { method: 'POST', body: JSON.stringify(b) });
    assert.equal((await post({ tourId: 2, departure: '2026-10-07T09:00:00Z', outcome: 'cancelled', reason: 'wind' })).status, 202);
    assert.equal((await post({ tourId: 2, outcome: 'ran' })).status, 422);
    const csv = await (await fetch(`${base}/api/ingest/outcomes.csv`)).text();
    assert.match(csv, /tourId;departure;outcome/);
  });
});

test('server: static whitelist blocks server code and traversal', async () => {
  await withServer(async base => {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /^<!doctype html>/i);   // real HTML, not a serialized Buffer
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.match(await (await fetch(`${base}/src/live.js`)).text(), /^\/\/ Data loading/);
    assert.equal((await fetch(`${base}/server/index.js`)).status, 404);
    assert.equal((await fetch(`${base}/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/..%2fserver/index.js`)).status, 404);
  });
});
