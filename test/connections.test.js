// Connectors added for multi-model weather and Vegagerðin. Response shapes are hand-built from
// documentation and from field names confirmed in open-source clients of the Vegagerðin feeds.
import test from 'node:test';
import assert from 'node:assert/strict';

const { setFetch } = await import('../server/lib/http.js');
const { clearCache } = await import('../server/lib/cache.js');
const { default: omList, toRegionMap, modelConnector } = await import('../server/connectors/openmeteo.js');
const { parseOneCall } = await import('../server/connectors/openweather.js');
const { default: vg, parseRoads, stations } = await import('../server/connectors/vegagerdin.js');
const { matchSections, getRoads } = await import('../server/services/roads.js');
const { mergeObservations } = await import('../server/services/observations.js');
const { loadConnectors, withKind } = await import('../server/registry.js');
const { createServer } = await import('../server/index.js');

const json = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
const hours = n => Array.from({ length: n }, (_, i) => `2026-10-14T${String(i % 24).padStart(2, '0')}:00`);

test('registry: Open-Meteo yields the primary connector plus one per model, each its own source', async () => {
  assert.deepEqual(omList.map(c => c.id), ['openmeteo', 'openmeteo-ecmwf_ifs025', 'openmeteo-icon_seamless', 'openmeteo-gfs_seamless']);
  const all = await loadConnectors();
  const fc = withKind(all, 'forecast').map(c => c.id);
  for (const id of ['openmeteo', 'metno', 'openmeteo-ecmwf_ifs025', 'openweather']) assert.ok(fc.includes(id), id);
  assert.ok(all.find(c => c.id === 'vegagerdin-roads') && all.find(c => c.id === 'vegagerdin-stations'));
});

test('Open-Meteo per-model: reads suffixed keys, falls back to plain keys, requests models=…', async () => {
  let url;
  setFetch(async u => { url = String(u); return json([{ hourly: { time: hours(2), wind_gusts_10m_icon_seamless: [20, 21], wind_gusts_10m: [1, 1] } }]); });
  const out = await modelConnector('icon_seamless').forecast({ sites: { a: { lat: 64, lon: -21 } } });
  assert.equal(out.a['2026-10-14T01'].g, 21);          // suffixed key wins
  assert.match(url, /models=icon_seamless/);
  const plain = toRegionMap(['a'], [{ hourly: { time: hours(1), wind_gusts_10m: [9] } }], { g: 'wind_gusts_10m' }, 'gfs_seamless');
  assert.equal(plain.a['2026-10-14T00'].g, 9);          // single-model responses are unsuffixed
});

test('OpenWeatherMap One Call: gust falls back to wind speed; rain+snow summed', () => {
  const o = parseOneCall({ hourly: [{ dt: Date.UTC(2026, 9, 14, 3) / 1000, wind_speed: 8, wind_gust: 14, wind_deg: 200, clouds: 80, temp: 4, rain: { '1h': 1.2 }, snow: { '1h': 0.3 } }, { dt: Date.UTC(2026, 9, 14, 4) / 1000, wind_speed: 9 }] });
  assert.deepEqual(o['2026-10-14T03'], { g: 14, w: 8, dir: 200, p: 1.5, c: 80, t: 4 });
  assert.equal(o['2026-10-14T04'].g, 9);
});

const FEED = [
  { IdButur: '1001', FulltNafnButs: 'Hringvegur um Hellisheiði', StuttNafnButs: 'Hringv. Hellish.', AstandYfirbord: 'GREIDFAERT', AstandLysing: 'Greiðfært', DagsKeyrtUt: '2026-10-14 08:10' },
  { IdButur: '2002', FulltNafnButs: 'Þórsmerkurvegur', StuttNafnButs: 'Þórsm.v.', AstandYfirbord: 'OFAERT_VEDUR', AstandLysing: 'Ófært vegna veðurs', AstandVidbotaruppl: 'Á ekki að fara' },
  { IdButur: '3003', FulltNafnButs: 'Kjalvegur', AstandYfirbord: 'LOKAD', AstandLysing: 'Lokað' },
];

test('Vegagerðin roads: parses documented fields and classifies LOKAD / OFAERT_* as closed', () => {
  const s = parseRoads(FEED);
  assert.equal(s.length, 3);
  assert.equal(s[0].state, 'open'); assert.equal(s[1].state, 'closed'); assert.equal(s[2].state, 'closed');
  assert.equal(s[1].name, 'Þórsmerkurvegur'); assert.equal(s[0].updated, '2026-10-14 08:10');
  const old = parseRoads([{ LangtNafn: 'Sprengisandsleið', StuttNafn: 'F26', FulltAstand: 'Lokað vegna snjóa', Aths: 'Opnar í júní' }]);
  assert.equal(old[0].state, 'closed'); assert.equal(old[0].note, 'Opnar í júní');   // legacy feed
});

test('roads service: tours are matched by section id or accent-insensitive name; closure blocks the tour', async () => {
  const sections = parseRoads(FEED);
  assert.equal(matchSections(sections, ['thorsmerkurvegur']).length, 1);      // accents ignored
  assert.equal(matchSections(sections, ['1001'])[0].name, 'Hringvegur um Hellisheiði');
  assert.equal(matchSections(sections, ['nonexistent']).length, 0);
  clearCache();
  setFetch(async u => String(u).includes('faerd2017_1') ? json(FEED) : (() => { throw new Error('blocked'); })());
  const r = await getRoads({ tours: [{ id: 7, roads: ['Þórsmerkurvegur'] }, { id: 8, roads: ['Hringvegur'] }, { id: 9 }] });
  assert.deepEqual(r.blocked, { 7: ['Þórsmerkurvegur'] });
  assert.equal(r.byTour[8][0].state, 'open'); assert.equal(r.byTour[9], undefined);
  assert.equal(r.totals.closed, 2);
});

test('Vegagerðin stations: Icelandic field names and sign-less longitude are understood', async () => {
  setFetch(async () => json([{ Nr: 31, Nafn: 'Hellisheiði', Breidd: '64,0', Lengd: '21,4', Vindhvida: '27,5', Vindhradi: '19', Vindatt: 90, Hiti: '-1,5', Dags: '2026-10-14 08:00' }]));
  const out = await stations.observation({ sites: { rvk: { lat: 64.1, lon: -21.9 }, north: { lat: 65.8, lon: -17.3 } } });
  assert.equal(out.regions.rvk.g, 27.5); assert.equal(out.regions.rvk.w, 19);
  assert.equal(out.regions.north, undefined);        // beyond 40 km
  assert.equal(stations.kinds[0], 'observation');
});

test('observations: merged across sources, a reading with gust beats one without', () => {
  const m = mergeObservations([{ id: 'imo', regions: { rvk: { g: null, w: 5 }, hl: { g: 12 } } }, { id: 'vg', regions: { rvk: { g: 20, w: 9 } } }]);
  assert.equal(m.rvk.g, 20); assert.equal(m.rvk.source, 'vg'); assert.equal(m.hl.source, 'imo');
});

test('server: /api/roads works with no tours configured for roads; /api/observations merges', async () => {
  clearCache();
  setFetch(async u => {
    const url = String(u);
    if (url.includes('faerd2017_1')) return json(FEED);
    if (url.includes('vedur2014_1')) return json([{ Nr: 1, Nafn: 'Reykjavík', Breidd: 64.13, Lengd: -21.9, Vindhvida: 14 }]);
    throw new Error('blocked');
  });
  const srv = createServer(); await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const roads = await (await fetch(`${base}/api/roads`)).json();
    assert.equal(roads.configured, true); assert.equal(roads.sections, undefined);   // full list stays admin-only
    assert.equal(roads.totals.closed, 2);
    const obs = await (await fetch(`${base}/api/observations`)).json();
    assert.equal(obs.regions.rvk.g, 14);
  } finally { srv.close(); }
});
