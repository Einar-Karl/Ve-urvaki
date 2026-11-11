// Outbound webhooks: other systems subscribe to events and get a signed POST when something happens.
//
//   Events   departure.risk_changed · departure.road_blocked · guest.choice_made · case.resolved ·
//            decision.recorded · ping (test)
//   Body     { "id": "evt_…", "type": "<event>", "createdAt": ISO, "data": { … } }
//   Headers  X-Vedurvaki-Event, X-Vedurvaki-Delivery, X-Vedurvaki-Signature: t=<unix>,v1=<hex>
//            v1 = HMAC-SHA256(secret, "<t>.<raw body>"); reject if |now - t| > 5 min (replay protection)
//   Retries  non-2xx or network error → retried after 1 min, 5 min, 30 min, 2 h, 6 h, then marked failed
//   Safety   URLs must be https and public (same SSRF checks as cameras); 10 s timeout; secrets stored server-side,
//            shown once at creation.
import crypto from 'node:crypto';
import { col } from '../lib/store.js';
import { newId, newToken } from '../lib/tokens.js';
import { fetchRaw, USER_AGENT } from '../lib/http.js';
import { assertAllowedUrl } from './cameras.js';

export const EVENTS = ['departure.risk_changed', 'departure.road_blocked', 'guest.choice_made', 'case.resolved', 'decision.recorded'];
const RETRY_MS = [60e3, 5 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3];
const subs = () => col('webhooks'), deliveries = () => col('webhook_deliveries');

export const sign = (secret, t, body) => crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
export function verify(secret, header, body, { now = Date.now(), toleranceS = 300 } = {}) {
  const m = /t=(\d+),v1=([0-9a-f]{64})/.exec(header || '');
  if (!m) return false;
  if (Math.abs(now / 1000 - +m[1]) > toleranceS) return false;
  const want = Buffer.from(sign(secret, m[1], body), 'hex'), got = Buffer.from(m[2], 'hex');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

export async function createSubscription({ url, events = ['*'], description = '' }, who = 'admin') {
  if (!Array.isArray(events) || !events.length || events.some(e => e !== '*' && !EVENTS.includes(e))) throw new Error(`events must be "*" or from: ${EVENTS.join(', ')}`);
  const u = new URL(url);
  if (u.protocol !== 'https:' && process.env.WEBHOOKS_ALLOW_HTTP !== '1') throw new Error('webhook URL must use https');
  await assertAllowedUrl(url);
  const rec = { id: newId('wh_'), url: u.href, events, description: String(description).slice(0, 200), secret: `whsec_${newToken(24)}`, active: true, createdAt: new Date().toISOString(), createdBy: who, failures: 0 };
  subs().put(rec);
  return rec;                                    // the only response that contains the secret
}
export const publicSub = ({ secret, ...rest }) => ({ ...rest, secretPreview: `${secret.slice(0, 10)}…` });
export const listSubscriptions = () => subs().all().map(publicSub).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const deleteSubscription = id => subs().remove(id);
export const setActive = (id, active) => { const s = subs().get(id); if (!s) return null; subs().put({ ...s, active: !!active, failures: active ? 0 : s.failures }); return publicSub(subs().get(id)); };
export const listDeliveries = (subId, limit = 50) => deliveries().find(d => !subId || d.subId === subId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(({ body, ...d }) => d);

async function attempt(d) {
  const s = subs().get(d.subId);
  if (!s) { deliveries().put({ ...d, status: 'cancelled', error: 'subscription deleted' }); return; }
  const t = Math.floor(Date.now() / 1000);
  const headers = { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT, 'X-Vedurvaki-Event': d.event, 'X-Vedurvaki-Delivery': d.id, 'X-Vedurvaki-Signature': `t=${t},v1=${sign(s.secret, t, d.body)}` };
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10000);
  let ok = false, status = null, error = null;
  try {
    await assertAllowedUrl(s.url);
    const res = await fetchRaw(s.url, { method: 'POST', headers, body: d.body, redirect: 'manual', signal: ctl.signal });
    status = res.status; ok = res.status >= 200 && res.status < 300;
    if (!ok) error = `HTTP ${res.status}`;
  } catch (e) { error = e.name === 'AbortError' ? 'timeout' : e.message; } finally { clearTimeout(timer); }
  const attempts = d.attempts + 1;
  const next = ok ? { status: 'delivered', deliveredAt: new Date().toISOString() }
    : attempts > RETRY_MS.length ? { status: 'failed' } : { status: 'retrying', nextAt: Date.now() + RETRY_MS[attempts - 1] };
  deliveries().put({ ...d, ...next, attempts, lastStatus: status, error });
  subs().put({ ...s, failures: ok ? 0 : (s.failures || 0) + 1, lastDeliveryAt: new Date().toISOString() });
}

// Queue an event for every active subscription that wants it; the first attempt starts immediately.
export function emit(event, data) {
  const list = subs().find(s => s.active && (s.events.includes('*') || s.events.includes(event)));
  if (!list.length) return [];
  const body = JSON.stringify({ id: newId('evt_'), type: event, createdAt: new Date().toISOString(), data });
  const ds = list.map(s => ({ id: newId('dlv_'), subId: s.id, event, body, attempts: 0, status: 'pending', createdAt: new Date().toISOString(), nextAt: Date.now() }));
  deliveries().putMany(ds);
  trimDeliveries();
  return Promise.all(ds.map(d => attempt(d).catch(() => {})));
}

let running = false;
export async function processDue(now = Date.now()) {
  if (running) return 0;
  running = true;
  try {
    const due = deliveries().find(d => ['pending', 'retrying'].includes(d.status) && d.nextAt <= now);
    for (const d of due) await attempt(d);
    return due.length;
  } finally { running = false; }
}
export const sendTest = id => { const s = subs().get(id); if (!s) return null; const body = JSON.stringify({ id: newId('evt_'), type: 'ping', createdAt: new Date().toISOString(), data: { message: 'Test event from Veðurvaki' } });
  const d = { id: newId('dlv_'), subId: id, event: 'ping', body, attempts: 0, status: 'pending', createdAt: new Date().toISOString(), nextAt: Date.now() };
  deliveries().put(d); return attempt(d).then(() => { const { body: _b, ...r } = deliveries().get(d.id); return r; }); };

function trimDeliveries(max = 2000) {
  const all = deliveries().all(); if (all.length <= max) return;
  all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, all.length - max).filter(d => !['pending', 'retrying'].includes(d.status)).forEach(d => deliveries().remove(d.id));
}
export function scheduleWebhooks() { setInterval(() => processDue().catch(() => {}), 30e3).unref(); }
