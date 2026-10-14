// Thin HTTP client shared by all connectors: User-Agent, timeout, JSON/text helpers, POST for messaging.
// MET Norway requires an identifying User-Agent; set VEDURVAKI_UA="Vedurvaki/0.4 you@example.com".
let impl = (...a) => fetch(...a);
export const setFetch = fn => { impl = fn; };

export const USER_AGENT = process.env.VEDURVAKI_UA || 'Vedurvaki/0.4 (+https://github.com/Einar-Karl/Ve-urvaki)';

async function request(url, { timeout = 8000, headers = {}, method = 'GET', body } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await impl(url, { method, body, signal: ctl.signal, headers: { 'User-Agent': USER_AGENT, ...headers } });
    if (!res.ok) {
      let snippet = '';
      try { snippet = (await res.text()).replace(/\s+/g, ' ').slice(0, 200); } catch { /* ignore */ }
      throw new Error(`HTTP ${res.status} from ${new URL(url).host}${snippet ? `: ${snippet}` : ''}`);
    }
    return res;
  } catch (e) {
    // Node's fetch hides the cause; surface it so "blocked by proxy" is distinguishable from "timeout".
    const cause = e.cause && (e.cause.code || e.cause.message);
    if (/^HTTP \d+/.test(e.message)) throw e;
    throw new Error(`${new URL(url).host}: ${e.name === 'AbortError' ? 'timeout' : e.message}${cause ? ` (${cause})` : ''}`);
  } finally { clearTimeout(timer); }
}

export const getJson = async (url, opt) => (await request(url, { ...opt, headers: { Accept: 'application/json', ...(opt && opt.headers) } })).json();
export const getText = async (url, opt) => (await request(url, opt)).text();
export const postJson = async (url, obj, opt = {}) =>
  (await request(url, { ...opt, method: 'POST', body: JSON.stringify(obj), headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...opt.headers } })).json();
export const postForm = async (url, form, opt = {}) =>
  (await request(url, { ...opt, method: 'POST', body: new URLSearchParams(form).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...opt.headers } })).json();
