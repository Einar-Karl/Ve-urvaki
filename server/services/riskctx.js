// Builds (and briefly caches) the risk engine from live forecast + tours + learned model + road status.
import { getForecast } from './forecast.js';
import { getRoads } from './roads.js';
import { loadModel } from './model.js';
import { readTours, buildSites, sitesSignature } from '../lib/sites.js';
import { makeRisk } from './risk.js';

let cache = null;
export async function getRiskContext({ mode = process.env.DATA_MODE || 'auto', now = new Date() } = {}) {
  const { tours, warnings } = readTours(), sites = buildSites(tours);
  const key = `${mode}:${Math.floor(now.getTime() / 300e3)}:${sitesSignature(sites)}`;
  if (cache && cache.key === key) return cache.ctx;
  const forecast = await getForecast({ mode, sites, now });
  let roads = null;
  try { const r = await getRoads({ tours }); roads = r.configured ? { configured: true, blocked: r.blocked, byTour: r.byTour } : null; } catch { /* roads are optional */ }
  const ctx = { ...makeRisk({ forecast, tours, warnings, model: loadModel(), roads }), forecastMode: forecast.mode, tours };
  cache = { key, ctx };
  return ctx;
}
export const resetRiskContext = () => { cache = null; };
