// Thin HTTP client shared by all connectors: User-Agent, timeout, JSON/text helpers.
// MET Norway requires an identifying User-Agent; set VEDURVAKI_UA="Vedurvaki/0.2 you@example.com".
let impl = (...a) => fetch(...a);
export const setFetch = fn => { impl = fn; };

export const USER_AGENT = process.env.VEDURVAKI_UA || 'Vedurvaki/0.2 (+https://github.com/Einar-Karl/Ve-urvaki)';

async function request(url, { timeout = 8000, headers = {} } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await impl(url, { signal: ctl.signal, headers: { 'User-Agent': USER_AGENT, ...headers } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res;
  } catch (e) {
    // Node's fetch hides the cause; surface it so "blocked by proxy" is distinguishable from "timeout".
    const cause = e.cause && (e.cause.code || e.cause.message);
    throw new Error(`${new URL(url).host}: ${e.name === 'AbortError' ? 'timeout' : e.message}${cause ? ` (${cause})` : ''}`);
  } finally { clearTimeout(timer); }
}

export const getJson = async (url, opt) => (await request(url, { ...opt, headers: { Accept: 'application/json', ...(opt && opt.headers) } })).json();
export const getText = async (url, opt) => (await request(url, opt)).text();
