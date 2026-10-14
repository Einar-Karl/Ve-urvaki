// Operator settings edited in the admin page: config/settings.json (human-readable, in the config volume).
// brand, contact details, disabled connectors, public base URL. Secrets are NEVER stored here (use .env).
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = () => process.env.SETTINGS_FILE || fileURLToPath(new URL('../../config/settings.json', import.meta.url));
export const DEFAULTS = {
  brand: { name: 'Arctic Adventures', color: '#0b5c70', logoUrl: '', phone: '', email: '', website: '' },
  disabledConnectors: [],
  defaultLang: 'en',
};
let memo = { mtime: 0, value: null };

export function getSettings() {
  const f = FILE();
  if (!existsSync(f)) return structuredClone(DEFAULTS);
  try {
    const raw = readFileSync(f, 'utf8');
    if (memo.raw !== raw) memo = { raw, value: JSON.parse(raw) };
    const v = memo.value;
    return { ...DEFAULTS, ...v, brand: { ...DEFAULTS.brand, ...(v.brand || {}) } };
  } catch { return structuredClone(DEFAULTS); }
}

export function saveSettings(patch) {
  const cur = getSettings();
  const next = { ...cur, ...patch, brand: { ...cur.brand, ...(patch.brand || {}) } };
  if (next.brand.color && !/^#[0-9a-fA-F]{6}$/.test(next.brand.color)) throw new Error('brand.color must look like #0b5c70');
  if (!Array.isArray(next.disabledConnectors)) throw new Error('disabledConnectors must be a list');
  if (!['en', 'de', 'is'].includes(next.defaultLang)) throw new Error('defaultLang must be en, de or is');
  const f = FILE();
  writeFileSync(f + '.tmp', JSON.stringify(next, null, 2) + '\n');
  renameSync(f + '.tmp', f);
  memo = {};
  return next;
}
