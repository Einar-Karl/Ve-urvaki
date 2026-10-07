// Connector registry. Every .js file in server/connectors/ (and in $CONNECTORS_DIR, for add-ons kept
// outside this repo) that default-exports { id, label, kinds, ... } is picked up automatically.
// See docs/ADDONS.md for the contract.
import { readdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';

let cached;
export async function loadConnectors() {
  if (cached) return cached;
  const dirs = [fileURLToPath(new URL('./connectors/', import.meta.url))];
  if (process.env.CONNECTORS_DIR) dirs.push(process.env.CONNECTORS_DIR);
  const list = [];
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter(f => f.endsWith('.js')).sort()) {
      const mod = await import(pathToFileURL(join(dir, f)).href);
      const c = mod.default;
      if (c && c.id && Array.isArray(c.kinds)) list.push(c);
    }
  }
  cached = list;
  return list;
}
export const withKind = (list, kind) => list.filter(c => c.kinds.includes(kind) && typeof c[kind] === 'function');
export const resetRegistry = () => { cached = undefined; };
