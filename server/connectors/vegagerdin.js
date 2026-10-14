// Vegagerðin (Icelandic Road and Coastal Administration) open data, three connectors:
//
//  vegagerdin-roads     road conditions per road section ("færð"): JSON list from the data hub.
//                       https://gagnaveita.vegagerdin.is/api/faerd2017_1  (override: VEGAGERDIN_ROADS_URL)
//                       Fields (confirmed by two open-source clients that consume this feed):
//                         IdButur, FulltNafnButs, StuttNafnButs, AstandYfirbord (LOKAD, OFAERT_VEDUR,
//                         OFAERT_ANNAD = not passable; anything else = passable), AstandLysing,
//                         AstandVidbotaruppl, DagsKeyrtUt, Snjomokstursregla.
//                       The older faerd2014_1 uses LangtNafn / StuttNafn / FulltAstand / Aths; also handled.
//                       The feed carries NO coordinates, so sections are linked to tours by name
//                       (tour.roads in config/tours.json, picked in the admin page).
//  vegagerdin-stations  road-weather stations (wind, gusts, temperature):
//                       https://gagnaveita.vegagerdin.is/api/vedur2014_1  (override: VEGAGERDIN_STATIONS_URL)
//                       Only Breidd/Lengd (lat/lon) and Dags (time) are confirmed; wind field names are
//                       matched against aliases. `npm run check` prints a sample record to confirm.
//  vegagerdin-datex     optional DATEX II publication, only if VEGAGERDIN_DATEX_URL is set.
import { getJson, getText } from '../lib/http.js';
import { normalizeRows, matchRegions } from './imo.js';
import { REGIONS } from '../lib/regions.js';

const ROADS_URL = () => process.env.VEGAGERDIN_ROADS_URL || 'https://gagnaveita.vegagerdin.is/api/faerd2017_1';
const STATIONS_URL = () => process.env.VEGAGERDIN_STATIONS_URL || 'https://gagnaveita.vegagerdin.is/api/vedur2014_1';
const DATEX_URL = () => process.env.VEGAGERDIN_DATEX_URL;

const CLOSED = /^(LOKAD|OFAERT)|lokað|lokad|ófært|ofaert/i;

export function parseRoads(j) {
  const rows = Array.isArray(j) ? j : (j.data || j.features?.map(f => f.properties) || []);
  return rows.filter(r => r && typeof r === 'object').map(r => {
    const code = String(r.AstandYfirbord ?? r.FulltAstand ?? '').trim();
    const desc = String(r.AstandLysing ?? r.FulltAstand ?? '').trim();
    const note = String(r.AstandVidbotaruppl ?? r.Aths ?? '').trim();
    return {
      id: String(r.IdButur ?? r.Id ?? '').trim(),
      name: String(r.FulltNafnButs ?? r.LangtNafn ?? r.StuttNafnButs ?? r.StuttNafn ?? '').trim(),
      short: String(r.StuttNafnButs ?? r.StuttNafn ?? '').trim(),
      state: CLOSED.test(code) || CLOSED.test(desc) ? 'closed' : 'open',
      code, desc, note,
      updated: r.DagsKeyrtUt ?? null,
    };
  }).filter(s => s.name || s.id);
}

const roads = {
  id: 'vegagerdin-roads',
  label: 'Vegagerðin · road conditions',
  kinds: ['road'],
  license: 'Vegagerðin open data (free to use; check current terms)',
  attribution: 'Road data: Vegagerðin',
  configured: () => true,
  async road() { return { sections: parseRoads(await getJson(ROADS_URL(), { timeout: 15000 })) }; },
  async ping() {
    const s = parseRoads(await getJson(ROADS_URL(), { timeout: 15000 }));
    return `${s.length} road sections, ${s.filter(x => x.state === 'closed').length} closed or impassable`;
  },
};

// Longitude sign guard: Iceland is 13–25°W. If a feed gives positive degrees west, negate.
const fixLon = x => (x != null && x > 0 && x >= 12 && x <= 26 ? -x : x);

export const stations = {
  id: 'vegagerdin-stations',
  label: 'Vegagerðin · road-weather stations',
  kinds: ['observation'],
  license: roads.license,
  attribution: 'Observations: Vegagerðin',
  configured: () => true,
  async observation({ sites = REGIONS } = {}) {
    const rows = normalizeRows(await getJson(STATIONS_URL(), { timeout: 15000 })).map(r => ({ ...r, lon: fixLon(r.lon) }));
    return { regions: matchRegions(rows, {}, 40, sites), stations: rows.length, sample: rows[0] || null };
  },
  async ping() {
    const rows = normalizeRows(await getJson(STATIONS_URL(), { timeout: 15000 }));
    return `${rows.length} stations, ${rows.filter(r => r.g != null).length} with gust, ${rows.filter(r => r.lat != null).length} with coordinates`;
  },
};

// ---- optional DATEX II (kept from the earlier version; reports into the same road shape) ----
const tagText = (xml, tag) => { const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([^<]*)</(?:\\w+:)?${tag}>`)); return m ? m[1].trim() : null; };
export function parseDatex(xml) {
  const recs = [...xml.matchAll(/<(?:\w+:)?situationRecord\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?situationRecord>/g)];
  return recs.map(([, attrs, body]) => {
    const type = (attrs.match(/xsi:type="([^"]+)"/) || [])[1] || 'SituationRecord';
    const lat = parseFloat(tagText(body, 'latitude')), lon = parseFloat(tagText(body, 'longitude'));
    return {
      id: (attrs.match(/\bid="([^"]+)"/) || [])[1] || null, type: type.replace(/^\w+:/, ''),
      start: tagText(body, 'overallStartTime'), end: tagText(body, 'overallEndTime'),
      comment: tagText(body, 'value') || tagText(body, 'comment'),
      closed: /closed|closure|lokað|lokun/i.test(type + ' ' + body),
      lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null,
    };
  });
}
const datex = {
  id: 'vegagerdin-datex',
  label: 'Vegagerðin · DATEX II (optional)',
  kinds: ['road'],
  license: roads.license,
  attribution: 'Road data: Vegagerðin',
  configured: () => !!DATEX_URL(),
  async road() {
    const recs = parseDatex(await getText(DATEX_URL(), { timeout: 15000, headers: process.env.VEGAGERDIN_AUTH ? { Authorization: process.env.VEGAGERDIN_AUTH } : {} }));
    return { sections: recs.map(r => ({ id: r.id || '', name: r.comment || r.type, short: r.type, state: r.closed ? 'closed' : 'open', code: r.type, desc: r.comment || '', note: '', updated: r.start })) };
  },
  async ping() {
    if (!DATEX_URL()) throw Object.assign(new Error('VEGAGERDIN_DATEX_URL not set (optional)'), { unconfigured: true });
    return `${parseDatex(await getText(DATEX_URL())).length} situation records`;
  },
};

export default [roads, stations, datex];
