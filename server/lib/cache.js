// Tiny in-memory TTL cache with stale-on-error, so a provider outage during a demo
// serves the last good answer instead of an error. Also keeps providers within fair-use limits.
const store = new Map();

export async function memo(key, ttlMs, fn) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  try {
    const value = await fn();
    store.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    if (hit) return Object.assign(Array.isArray(hit.value) ? hit.value : { ...hit.value }, { stale: true });
    throw e;
  }
}
export const clearCache = () => store.clear();
