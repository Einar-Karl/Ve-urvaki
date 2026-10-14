// Road status for the dashboard and risk model. Sections come from every enabled `road` connector
// (Vegagerðin conditions, optional DATEX). A tour lists the road sections that matter to it in
// config/tours.json  "roads": ["Hringvegur", "Þórsmerkurvegur", "<IdButur>"]  and a match is by exact
// section id or by accent/case-insensitive name fragment. If any matched section is closed or
// impassable, the dashboard treats the tour's next departures (within 24 h) as very likely cancelled.
import { memo } from '../lib/cache.js';
import { loadConnectors, withKind } from '../registry.js';

// Icelandic-aware: þ→th, ð→d, æ→ae, then strip accents, so "thorsmerkurvegur" matches "Þórsmerkurvegur".
export const norm = s => String(s || '').toLowerCase().replace(/þ/g, 'th').replace(/ð/g, 'd').replace(/æ/g, 'ae').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

export function matchSections(sections, patterns) {
  const out = [], seen = new Set();
  for (const p of patterns || []) {
    const np = norm(p);
    if (!np) continue;
    for (const s of sections) {
      if (seen.has(s)) continue;
      if (s.id && norm(s.id) === np || norm(s.name).includes(np) || norm(s.short).includes(np)) { seen.add(s); out.push(s); }
    }
  }
  return out;
}

export async function getRoads({ tours = [], now = new Date() } = {}) {
  const list = withKind(await loadConnectors(), 'road').filter(c => c.configured());
  if (!list.length) return { configured: false, byTour: {}, blocked: {}, sections: [], sources: [] };
  const res = await Promise.allSettled(list.map(c => memo(`road:${c.id}`, 2 * 60e3, () => c.road())));
  const sources = res.map((r, i) => ({ id: list[i].id, label: list[i].label, attribution: list[i].attribution, ok: r.status === 'fulfilled', ...(r.status === 'rejected' ? { error: r.reason.message } : {}) }));
  const sections = res.filter(r => r.status === 'fulfilled').flatMap(r => r.value.sections);
  if (!sections.length && sources.every(s => !s.ok)) throw new Error('No road source reachable: ' + sources.map(s => `${s.id}: ${s.error}`).join('; '));
  const byTour = {}, blocked = {};
  for (const t of tours) {
    const m = matchSections(sections, t.roads);
    if (!m.length) continue;
    byTour[t.id] = m.map(s => ({ id: s.id, name: s.name, state: s.state, code: s.code, desc: s.desc, updated: s.updated }));
    const bad = m.filter(s => s.state === 'closed');
    if (bad.length) blocked[t.id] = bad.map(s => s.name || s.id);
  }
  return {
    configured: true, fetchedAt: now.toISOString(), sources, byTour, blocked,
    totals: { sections: sections.length, closed: sections.filter(s => s.state === 'closed').length },
    sections: sections.map(({ id, name, short, state, code, desc, note, updated }) => ({ id, name, short, state, code, desc, note, updated })),
  };
}
