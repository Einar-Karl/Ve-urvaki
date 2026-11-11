// On Vercel the deployment is read-only except /tmp, which is private to one function instance and is wiped
// when the instance is recycled. This points every writable path at /tmp and seeds it from the repo's config/
// so the app starts normally. NOTHING written there is durable: use it for demos (see docs/VERCEL.md).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_FILES = { TOURS_FILE: 'tours.json', SETTINGS_FILE: 'settings.json', POLICY_FILE: 'policy.json', CAMERAS_FILE: 'cameras.json', MODEL_FILE: 'thresholds.json' };

export function prepareRuntime({ env = process.env, root = fileURLToPath(new URL('../..', import.meta.url)), tmp = '/tmp/vedurvaki' } = {}) {
  if (!env.VERCEL) return false;
  const cfg = join(tmp, 'config');
  mkdirSync(cfg, { recursive: true });
  env.STORE_DIR ||= join(tmp, 'store') + '/';
  env.INGEST_DIR ||= join(tmp, 'ingest') + '/';
  for (const [key, name] of Object.entries(CONFIG_FILES)) {
    if (env[key]) continue;
    const dest = join(cfg, name), src = join(root, 'config', name);
    if (!existsSync(dest) && existsSync(src)) copyFileSync(src, dest);
    env[key] = dest;                                   // may not exist yet: readers treat a missing file as "defaults"
  }
  return true;
}
