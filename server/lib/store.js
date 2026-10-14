// Tiny JSON-file store for mutable records (guests, cases, messages, keys, audit log, vouchers).
// One file per collection under data/store/ (STORE_DIR to relocate), written atomically
// (temp file + rename) and cached in memory. Fine for one operator's volume; swap for a database later.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = () => process.env.STORE_DIR || fileURLToPath(new URL('../../data/store/', import.meta.url));
const cache = new Map();

export function col(name) {
  const file = () => `${dir().replace(/\/?$/, '/')}${name}.json`;
  const load = () => {
    const key = file();
    if (!cache.has(key)) {
      let obj = {};
      if (existsSync(key)) { try { obj = JSON.parse(readFileSync(key, 'utf8')); } catch { obj = {}; } }
      cache.set(key, obj);
    }
    return cache.get(key);
  };
  const save = () => {
    const f = file(), d = f.slice(0, f.lastIndexOf('/'));
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
    writeFileSync(f + '.tmp', JSON.stringify(load()));
    renameSync(f + '.tmp', f);
  };
  return {
    all: () => Object.values(load()),
    get: id => load()[id] ?? null,
    put(rec) { if (rec.id == null) throw new Error('record needs an id'); load()[rec.id] = rec; save(); return rec; },
    putMany(recs) { for (const r of recs) load()[r.id] = r; save(); return recs.length; },
    remove(id) { const had = id in load(); delete load()[id]; if (had) save(); return had; },
    find: fn => Object.values(load()).filter(fn),
    count: () => Object.keys(load()).length,
    clearCache: () => cache.delete(file()),
  };
}
export const resetStoreCache = () => cache.clear();
