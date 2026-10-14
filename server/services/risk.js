// The server uses the dashboard's OWN risk model (src/data.js + src/model.js + src/live.js) inside a vm
// sandbox, so what guests are told and what the duty manager sees can never disagree.
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = ['data', 'model', 'live'].map(f => readFileSync(new URL(`../../src/${f}.js`, import.meta.url), 'utf8'));

export function makeRisk({ forecast, tours, warnings = [], model = null, roads = null }) {
  const ctx = vm.createContext({ Math, Date, Object, Array, JSON, Number, String, Map, Set, console });
  for (const code of SRC) vm.runInContext(code, ctx, { timeout: 2000 });
  ctx.__tours = JSON.parse(JSON.stringify({ tours, warnings, demo: false }));
  ctx.__fc = JSON.parse(JSON.stringify({ start: forecast.start, nowHour: forecast.nowHour, regions: forecast.regions }));
  ctx.__model = model; ctx.__roads = roads;
  vm.runInContext(`applyTours(__tours); START=new Date(__fc.start); NOW=__fc.nowHour; LIVE=__fc.regions; MODEL=__model; applyModel(); ROADS=__roads;`, ctx);
  const startMs = Date.parse(forecast.start);
  const hours = Math.min(...Object.values(forecast.regions).map(a => a.length));
  const run = (code, vars) => { Object.assign(ctx, vars); return JSON.parse(vm.runInContext(code, ctx, { timeout: 2000 })); };

  return {
    startMs, hours, nowMs: startMs + forecast.nowHour * 3600e3,
    hourIndex: iso => Math.round((Date.parse(iso) - startMs) / 3600e3),
    // null when the departure is outside the forecast window
    riskAt(tourId, iso) {
      const h = Math.round((Date.parse(iso) - startMs) / 3600e3);
      if (h < 0 || h >= hours) return null;
      return run('JSON.stringify(risk(TOURS.find(t=>String(t.id)===String(__id)),__h))', { __id: tourId, __h: h });
    },
    factors: tourId => run('JSON.stringify(tourF(TOURS.find(t=>String(t.id)===String(__id))))', { __id: tourId }),
  };
}
