// Managed API keys for other programs (booking tools, partners, Zapier). Shown once at creation, stored
// hashed, revocable. Scopes: "ingest" (POST /api/ingest/*), "tours" (GET/PUT /api/partner/tours).
import { col } from '../lib/store.js';
import { newId, newToken, sha256 } from '../lib/tokens.js';

export const SCOPES = ['ingest', 'tours'];
const keys = () => col('keys');

export function createKey({ name, scopes = ['ingest'] }) {
  if (!name || !String(name).trim()) throw new Error('name is required');
  if (!Array.isArray(scopes) || !scopes.length || scopes.some(s => !SCOPES.includes(s))) throw new Error(`scopes must be a non-empty subset of ${SCOPES.join(', ')}`);
  const plain = `vv_${newToken(24)}`;
  const rec = { id: newId('key_'), name: String(name).trim(), scopes, prefix: plain.slice(0, 11), hash: sha256(plain), createdAt: new Date().toISOString(), lastUsedAt: null, revoked: false };
  keys().put(rec);
  return { ...publicKey(rec), key: plain };       // the only time the plaintext is returned
}
export const publicKey = ({ hash, ...rest }) => rest;
export const listKeys = () => keys().all().map(publicKey).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const revokeKey = id => { const k = keys().get(id); if (!k) return false; keys().put({ ...k, revoked: true, revokedAt: new Date().toISOString() }); return true; };

export function verifyKey(plain) {
  if (!plain || typeof plain !== 'string') return null;
  const h = sha256(plain);
  const k = keys().find(k => k.hash === h && !k.revoked)[0];
  if (!k) return null;
  if (!k.lastUsedAt || Date.now() - Date.parse(k.lastUsedAt) > 60e3) keys().put({ ...k, lastUsedAt: new Date().toISOString() });
  return { id: k.id, name: k.name, scopes: k.scopes };
}
