// Generates fixtures/forecast.json and fixtures/history.json for the offline demo fallback.
// SYNTHETIC: forecast comes from the prototype's built-in model, history from a seeded random
// generator with a handful of storm days. The API and UI label these as "demo" everywhere.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';

const src = ['data', 'model'].map(f => readFileSync(new URL(`../src/${f}.js`, import.meta.url), 'utf8')).join('\n');
const ctx = vm.createContext({ Math, Date, Object });
vm.runInContext(`let LIVE=null;${src};this.REG=REG;this.wxSynthetic=wxSynthetic;`, ctx);
const { REG, wxSynthetic } = ctx;

const r1 = x => Math.round(x * 10) / 10;
const forecast = { demo: true, hours: 96, regions: {} };
for (const id of Object.keys(REG)) {
  forecast.regions[id] = Array.from({ length: 96 }, (_, h) => {
    const x = wxSynthetic(id, h);
    return { g: x.g, w: x.w, dir: Math.round(x.dir), p: x.p, c: x.c, t: x.t, s: x.s, sp: 0 };
  });
}

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20261005);
const DAYS = 30;
const storms = [3, 8, 9, 15, 21, 22, 27].map(d => ({ d, amp: 0.6 + rnd() * 0.8 })); // shared weather systems
const history = { demo: true, days: DAYS, regions: {} };
for (const [id, R] of Object.entries(REG)) {
  const g = [], p = [];
  for (let h = 0; h < DAYS * 24; h++) {
    const day = h / 24;
    const storm = storms.reduce((s, e) => s + e.amp * Math.exp(-(((day - e.d - 0.5) / 0.7) ** 2)), 0);
    const diurnal = Math.sin(((h % 24) - 9) / 24 * 2 * Math.PI);
    const w = R.b + R.a * 0.8 * storm * (0.8 + rnd() * 0.4) + 1.2 * diurnal + (rnd() - 0.5) * 1.5;
    g.push(r1(Math.max(1, w * 1.55)));
    p.push(r1(Math.max(0, R.p * 0.5 * storm * rnd() + rnd() * 0.3)));
  }
  history.regions[id] = { g, p };
}

mkdirSync(new URL('../fixtures/', import.meta.url), { recursive: true });
writeFileSync(new URL('../fixtures/forecast.json', import.meta.url), JSON.stringify(forecast));
writeFileSync(new URL('../fixtures/history.json', import.meta.url), JSON.stringify(history));
console.log('wrote fixtures/forecast.json and fixtures/history.json');
