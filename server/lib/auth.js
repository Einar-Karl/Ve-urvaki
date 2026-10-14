// Who may call what.
//   public     /healthz, guest pages and APIs (/g/<token>, /api/guest/…): protected by unguessable tokens
//   key        header x-api-key: INGEST_TOKEN (env) or a managed key; only /api/ingest/* and /api/partner/*
//   admin      /admin*, /api/admin/*: ADMIN_PASSWORD (user ADMIN_USER, default "admin"), else the dashboard login
//   dashboard  everything else: DASHBOARD_PASSWORD (user DASHBOARD_USER, default "arctic"); admin login also works
// With no passwords set (local development) the dashboard and admin are open; the server warns at start-up.
import { safeEq } from './tokens.js';
import { verifyKey } from '../services/keys.js';

const env = k => process.env[k];
const PUBLIC = [/^\/healthz$/, /^\/g\/[\w-]+$/, /^\/guest\.html$/, /^\/src\/guest[\w.-]*$/, /^\/src\/shared[\w.-]*$/, /^\/api\/guest\//, /^\/favicon\.ico$/];
const ADMIN = [/^\/admin(\.html)?$/, /^\/src\/admin[\w.-]*$/, /^\/api\/admin\//];

export const isPublic = p => PUBLIC.some(r => r.test(p));
export const isAdminPath = p => ADMIN.some(r => r.test(p));

function basic(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return null;
  const [u, ...rest] = Buffer.from(h.slice(6), 'base64').toString().split(':');
  return { user: u, pass: rest.join(':') };
}
const matches = (c, user, pass) => c && pass != null && safeEq(c.user, user) && safeEq(c.pass, pass);

export function check(req, p) {
  if (isPublic(p)) return { ok: true, who: 'public' };

  const key = req.headers['x-api-key'];
  if (key) {
    const need = p.startsWith('/api/ingest/') ? 'ingest' : p.startsWith('/api/partner/tours') ? 'tours' : p.startsWith('/api/partner/') ? 'ingest' : null;
    if (!need) return { ok: false, realm: 'Veðurvaki', reason: 'API keys only work on /api/ingest/* and /api/partner/*' };
    if (env('INGEST_TOKEN') && safeEq(key, env('INGEST_TOKEN')) && need === 'ingest') return { ok: true, who: 'key:env', role: 'key' };
    const k = verifyKey(key);
    if (k && (k.scopes.includes(need) || (need === 'ingest' && k.scopes.includes('tours') && p.startsWith('/api/partner/')))) return { ok: true, who: `key:${k.name}`, role: 'key' };
    return { ok: false, realm: 'Veðurvaki', reason: 'invalid, revoked or insufficiently scoped API key' };
  }

  const dash = env('DASHBOARD_PASSWORD'), adm = env('ADMIN_PASSWORD');
  const c = basic(req);
  const dashOk = () => dash && matches(c, env('DASHBOARD_USER') || 'arctic', dash);
  const admOk = () => adm && matches(c, env('ADMIN_USER') || 'admin', adm);

  if (isAdminPath(p)) {
    if (adm) return admOk() ? { ok: true, who: `admin:${c.user}`, role: 'admin' } : { ok: false, realm: 'Veðurvaki Admin' };
    if (dash) return dashOk() ? { ok: true, who: `admin:${c.user}`, role: 'admin' } : { ok: false, realm: 'Veðurvaki Admin' };
    return { ok: true, who: 'dev', role: 'admin' };
  }
  if (!dash && !adm) {
    // development: open, except that INGEST_TOKEN still guards writes to the ingest API
    if (p.startsWith('/api/ingest/') && req.method === 'POST' && env('INGEST_TOKEN')) return { ok: false, realm: 'Veðurvaki', reason: 'invalid or missing x-api-key' };
    return { ok: true, who: 'dev', role: 'dashboard' };
  }
  if (dashOk() || admOk()) return { ok: true, who: `user:${c.user}`, role: 'dashboard' };
  return { ok: false, realm: 'Veðurvaki' };
}
