// Cameras linked to tours, so someone in the office can see the situation at a site when nobody is there.
//
// Two kinds of entry in config/cameras.json:
//   page   a link to a public camera page (Vegagerðin road cameras, Met Office webcams, a partner's page).
//          Opened in a new tab, never embedded, so the owner's terms are respected.
//   image  a JPEG/PNG snapshot URL polled by THIS server and relayed to the dashboard. Meant for your OWN
//          cameras (run Frigate, go2rtc, MediaMTX, MotionEye… on site: see docs/CAMERAS.md). For a third-party
//          image the admin must record the permission it relies on.
// The browser never contacts the camera directly: it asks /api/cameras/<id>/snapshot. The server only ever
// fetches URLs that an admin saved, refuses private/internal addresses (SSRF) unless the camera is marked
// "own" AND CAMERAS_ALLOW_PRIVATE=1, rejects non-images (and SVG), caps the size, and re-uses a cached frame.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns/promises';
import net from 'node:net';
import { fetchRaw } from '../lib/http.js';

const FILE = () => process.env.CAMERAS_FILE || fileURLToPath(new URL('../../config/cameras.json', import.meta.url));
export const SOURCES = ['own', 'vegagerdin', 'imo', 'partner', 'other'];
export const TYPES = ['image', 'page'];
const MAX_BYTES = 4 * 1024 * 1024, STALE_OK_MS = 15 * 60e3;
const OK_IMAGE = /^image\/(jpeg|jpg|png|webp|gif)\b/i;

export const resolver = { lookup: host => dns.lookup(host, { all: true }) };   // replaceable in tests

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return v === '::' || v === '::1' || v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd');
}

export async function assertAllowedUrl(urlStr, { own = false } = {}) {
  let u; try { u = new URL(urlStr); } catch { throw new Error('invalid camera URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('camera URL must be http or https');
  if (u.username || u.password) throw new Error('put credentials in the authEnv variable, not in the URL');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await resolver.lookup(host);
  const priv = addrs.some(a => isPrivateAddress(a.address));
  if (priv && !(own && process.env.CAMERAS_ALLOW_PRIVATE === '1')) throw new Error('refusing to fetch a private/internal address (own cameras on a private network need CAMERAS_ALLOW_PRIVATE=1)');
  return u;
}

export function validateCamera(c) {
  const e = [], n = `Camera "${c && c.id}"`;
  if (!c || typeof c !== 'object') return ['camera must be an object'];
  if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(c.id || '')) e.push(`${n}: id must be lowercase letters, digits, - or _ (2–41 characters)`);
  if (!c.name || !String(c.name).trim()) e.push(`${n}: name is required`);
  if (!TYPES.includes(c.type)) e.push(`${n}: type must be one of ${TYPES.join(', ')}`);
  if (!SOURCES.includes(c.source || 'other')) e.push(`${n}: source must be one of ${SOURCES.join(', ')}`);
  try { const u = new URL(c.url); if (!['http:', 'https:'].includes(u.protocol)) throw 0; if (u.username || u.password) e.push(`${n}: no credentials in the URL (use authEnv)`); } catch { e.push(`${n}: url must be a valid http(s) address`); }
  if (c.tours != null && !(Array.isArray(c.tours) && c.tours.every(x => Number.isFinite(+x)))) e.push(`${n}: tours must be a list of tour ids`);
  if (c.type === 'image') {
    if (c.refreshSec != null && !(c.refreshSec >= 15 && c.refreshSec <= 3600)) e.push(`${n}: refreshSec must be between 15 and 3600`);
    if (!c.own && !String(c.permission || '').trim()) e.push(`${n}: a third-party image needs "permission": the licence or written permission that allows showing it`);
  }
  if (c.authEnv != null && c.authEnv !== '' && !/^[A-Z][A-Z0-9_]*$/.test(c.authEnv)) e.push(`${n}: authEnv must be an environment variable name like CAM_FRIGATE_AUTH`);
  return e;
}

export function readCameras() {
  const f = FILE();
  if (!existsSync(f)) return [];
  try { return JSON.parse(readFileSync(f, 'utf8')).cameras || []; } catch { return []; }
}
export function saveCameras(list) {
  const cams = list.map(c => ({ enabled: true, source: 'other', ...c, id: String(c.id).trim(), tours: (c.tours || []).map(Number) }));
  const errors = cams.flatMap(validateCamera);
  const ids = cams.map(c => c.id); ids.filter((id, i) => ids.indexOf(id) !== i).forEach(id => errors.push(`duplicate camera id "${id}"`));
  if (errors.length) return { ok: false, errors };
  const f = FILE();
  writeFileSync(f + '.tmp', JSON.stringify({ cameras: cams }, null, 2) + '\n');
  renameSync(f + '.tmp', f);
  cache.clear();
  return { ok: true, count: cams.length };
}
export const upsertCamera = c => { const cur = readCameras().filter(x => x.id !== c.id); return saveCameras([...cur, c]); };
export const removeCamera = id => { const cur = readCameras(), next = cur.filter(c => c.id !== id); return next.length === cur.length ? { ok: false, errors: ['no such camera'] } : saveCameras(next); };

// What the dashboard may see: never the snapshot URL or credentials of an image camera.
export const publicList = () => readCameras().filter(c => c.enabled !== false).map(c => ({
  id: c.id, name: c.name, type: c.type, source: c.source || 'other', tours: c.tours || [], global: !!c.global, attribution: c.attribution || '',
  refreshSec: c.refreshSec || 60, ...(c.type === 'page' ? { url: c.url } : {}),
}));

// ---- snapshot relay ----
const cache = new Map();
async function readCapped(res) {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader(), chunks = []; let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > MAX_BYTES) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error('image is too large'); } chunks.push(value); }
    return Buffer.concat(chunks);
  }
  const b = Buffer.from(await res.arrayBuffer()); if (b.length > MAX_BYTES) throw new Error('image is too large'); return b;
}

async function fetchImage(cam) {
  let url = cam.url;
  for (let hop = 0; hop < 3; hop++) {                       // follow at most 3 redirects, re-checking each target
    const u = await assertAllowedUrl(url, { own: !!cam.own });
    const headers = { Accept: 'image/*' };
    if (cam.authEnv && process.env[cam.authEnv]) headers.Authorization = process.env[cam.authEnv];
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await fetchRaw(u.href, { headers, redirect: 'manual', signal: ctl.signal });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), u).href; continue; }
      if (!res.ok) throw new Error(`camera answered HTTP ${res.status}`);
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!OK_IMAGE.test(type)) throw new Error(`not a supported image (${type || 'no content-type'})`);
      return { buf: await readCapped(res), type, at: Date.now(), modified: res.headers.get('last-modified') || null };
    } finally { clearTimeout(timer); }
  }
  throw new Error('too many redirects');
}

export async function snapshot(id, { fresh = false, now = Date.now() } = {}) {
  const cam = readCameras().find(c => c.id === id && c.enabled !== false && c.type === 'image');
  if (!cam) return null;
  const hit = cache.get(id), ttl = Math.max(15, cam.refreshSec || 60) * 1000;
  if (hit && !fresh && now - hit.at < ttl) return { ...hit, stale: false };
  try {
    const img = await fetchImage(cam); img.at = now; cache.set(id, img); return { ...img, stale: false };
  } catch (e) {
    // A forced fetch (admin "Test") must report the real failure; normal views may show a recent frame marked stale.
    if (hit && !fresh && now - hit.at < STALE_OK_MS) return { ...hit, stale: true, error: e.message };
    throw e;
  }
}
export const clearCameraCache = () => cache.clear();
