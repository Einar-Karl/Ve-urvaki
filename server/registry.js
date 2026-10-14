// Connector registry. Every .js file in server/connectors/ (and in $CONNECTORS_DIR, for add-ons kept
// outside this repo) that default-exports a connector { id, label, kinds, ... } or an ARRAY of them is
// picked up automatically. Connectors can be switched off in the admin page (config/settings.json).
// See docs/ADDONS.md for the contract.
import { readdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { getSettings } from './lib/settings.js';

let cached;
export async function loadConnectors() {
  if (cached) return cached;
  const dirs = [fileURLToPath(new URL('./connectors/', import.meta.url))];
  if (process.env.CONNECTORS_DIR) dirs.push(process.env.CONNECTORS_DIR);
  const list = [];
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
      const mod = await import(pathToFileURL(join(dir, f)).href);
      for (const c of [].concat(mod.default || [])) if (c && c.id && Array.isArray(c.kinds)) list.push(c);
    }
  }
  cached = list;
  return list;
}
export const isEnabled = id => !(getSettings().disabledConnectors || []).includes(id);
export const withKind = (list, kind) => list.filter(c => c.kinds.includes(kind) && typeof c[kind] === 'function' && isEnabled(c.id));
export const resetRegistry = () => { cached = undefined; };
