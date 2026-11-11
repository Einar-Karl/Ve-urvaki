// Operator settings edited in the admin page: config/settings.json (human-readable, in the config volume).
// brand, contact details, disabled connectors, public base URL. Secrets are NEVER stored here (use .env).
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = () => process.env.SETTINGS_FILE || fileURLToPath(new URL('../../config/settings.json', import.meta.url));
export const DEFAULTS = {
  brand: { name: 'Arctic Adventures', color: '#0b5c70', logoUrl: '', phone: '', email: '', website: '' },
  disabledConnectors: [],
  defaultLang: 'en',
  // provider "mapbox" (default; needs MAPBOX_TOKEN, a PUBLIC pk.* token, in .env), "osm" (OpenStreetMap's servers:
  // light use only) or "custom" (tilesUrl + attribution of a provider you have a licence for).
  map: { provider: 'mapbox', style: 'mapbox/outdoors-v12', tilesUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxZoom: 14, disabled: false },
};
let memo = { mtime: 0, value: null };

export function getSettings() {
  const f = FILE();
  if (!existsSync(f)) return structuredClone(DEFAULTS);
  try {
    const raw = readFileSync(f, 'utf8');
    if (memo.raw !== raw) memo = { raw, value: JSON.parse(raw) };
    const v = memo.value;
    return { ...DEFAULTS, ...v, brand: { ...DEFAULTS.brand, ...(v.brand || {}) }, map: { ...DEFAULTS.map, ...(v.map || {}) } };
  } catch { return structuredClone(DEFAULTS); }
}

export function saveSettings(patch) {
  const cur = getSettings();
  const next = { ...cur, ...patch, brand: { ...cur.brand, ...(patch.brand || {}) }, map: { ...cur.map, ...(patch.map || {}) } };
  if (!['mapbox', 'osm', 'custom'].includes(next.map.provider)) throw new Error('map.provider must be mapbox, osm or custom');
  if (!/^[\w-]+\/[\w.-]+$/.test(next.map.style || '')) throw new Error('map.style must look like mapbox/outdoors-v12');
  if (!/^https:\/\/[^\s]+\{z\}[^\s]*\{x\}[^\s]*\{y\}/.test(next.map.tilesUrl || '')) throw new Error('map.tilesUrl must be an https URL template containing {z}, {x} and {y}');
  next.map.maxZoom = Math.min(19, Math.max(5, +next.map.maxZoom || 12));
  if (next.brand.color && !/^#[0-9a-fA-F]{6}$/.test(next.brand.color)) throw new Error('brand.color must look like #0b5c70');
  if (!Array.isArray(next.disabledConnectors)) throw new Error('disabledConnectors must be a list');
  if (!['en', 'de', 'is'].includes(next.defaultLang)) throw new Error('defaultLang must be en, de or is');
  const f = FILE();
  writeFileSync(f + '.tmp', JSON.stringify(next, null, 2) + '\n');
  renameSync(f + '.tmp', f);
  memo = {};
  return next;
}

// What the browser gets. A Mapbox PUBLIC token (pk.*) is designed to be visible in web pages; restrict it to your
// domains in the Mapbox account. A secret token (sk.*) must never reach a browser, so it is refused here.
const MAPBOX_ATTR = '© <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> <strong><a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener">Improve this map</a></strong>';
export function mapConfig(s = getSettings(), env = process.env) {
  const m = s.map, token = env.MAPBOX_TOKEN || '';
  if (m.disabled) return { disabled: true };
  if (m.provider === 'mapbox') {
    if (/^sk\./.test(token)) return { disabled: true, warning: 'MAPBOX_TOKEN is a SECRET token (sk.*). Use a public token (pk.*) restricted to your domain.' };
    if (/^pk\./.test(token)) return { provider: 'mapbox', tilesUrl: `https://api.mapbox.com/styles/v1/${m.style}/tiles/512/{z}/{x}/{y}@2x?access_token=${encodeURIComponent(token)}`, tileSize: 512, zoomOffset: -1, attribution: MAPBOX_ATTR, maxZoom: m.maxZoom, style: m.style };
    return { provider: 'osm', tilesUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: Math.min(m.maxZoom, 14), warning: 'MAPBOX_TOKEN is not set: showing OpenStreetMap tiles (light use only).' };
  }
  if (m.provider === 'osm') return { provider: 'osm', tilesUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: Math.min(m.maxZoom, 14) };
  return { provider: 'custom', tilesUrl: m.tilesUrl, attribution: m.attribution, maxZoom: m.maxZoom };
}
