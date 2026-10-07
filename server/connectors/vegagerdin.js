// Vegagerðin (Icelandic Road and Coastal Administration) — DATEX II traffic/road-condition feed.
// Vegagerðin publishes DATEX II 3.1 pull services (point incidents, road conditions, road condition
// sections, measurement sites, measurement data). The exact service URL is NOT hard-coded because it
// could not be verified from the build sandbox: set VEGAGERDIN_DATEX_URL to the "point incidents" or
// "road conditions" URL from https://vegagerdin.is/vegagerdin/gagnasafn/vefthjonustur/datexii-2
// and optionally VEGAGERDIN_AUTH (sent as the Authorization header) if the service needs one.
// Until configured this connector reports "unconfigured" and the app simply shows no road alerts.
import { getText } from '../lib/http.js';
import { nearestRegion } from '../lib/regions.js';

const URL_DATEX = process.env.VEGAGERDIN_DATEX_URL;
const AUTH = process.env.VEGAGERDIN_AUTH;

const tagText = (xml, tag) => { const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([^<]*)</(?:\\w+:)?${tag}>`)); return m ? m[1].trim() : null; };

// Lenient extraction (namespace-agnostic) of situation records: type, id, times, comment, point.
export function parseDatex(xml) {
  const recs = [...xml.matchAll(/<(?:\w+:)?situationRecord\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?situationRecord>/g)];
  return recs.map(([, attrs, body]) => {
    const type = (attrs.match(/xsi:type="([^"]+)"/) || [])[1] || 'SituationRecord';
    const lat = parseFloat(tagText(body, 'latitude')), lon = parseFloat(tagText(body, 'longitude'));
    return {
      id: (attrs.match(/\bid="([^"]+)"/) || [])[1] || null,
      type: type.replace(/^\w+:/, ''),
      start: tagText(body, 'overallStartTime'), end: tagText(body, 'overallEndTime'),
      comment: tagText(body, 'value') || tagText(body, 'comment'),
      closed: /closed|closure|lokað|lokun/i.test(type + ' ' + body),
      lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null,
    };
  });
}

export default {
  id: 'vegagerdin',
  label: 'Vegagerðin · DATEX II',
  kinds: ['road'],
  license: 'Vegagerðin open service (check terms)',
  attribution: 'Road data: Vegagerðin',
  configured: () => !!URL_DATEX,
  async road() {
    if (!URL_DATEX) return { configured: false, records: [], byRegion: {} };
    const records = parseDatex(await getText(URL_DATEX, { timeout: 15000, headers: AUTH ? { Authorization: AUTH } : {} }));
    const byRegion = {};
    for (const r of records) {
      if (r.lat == null) continue;
      const n = nearestRegion(r);
      if (n) (byRegion[n.id] ||= []).push(r);
    }
    return { configured: true, records, byRegion };
  },
  async ping() {
    if (!URL_DATEX) throw Object.assign(new Error('VEGAGERDIN_DATEX_URL not set'), { unconfigured: true });
    const r = parseDatex(await getText(URL_DATEX, { headers: AUTH ? { Authorization: AUTH } : {} }));
    return `${r.length} situation records`;
  },
};
