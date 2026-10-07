// Iceland is on UTC all year, so UTC hours are local hours. Hour keys look like "2026-10-07T14".
export const utcMidnight = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const hourKey = d => d.toISOString().slice(0, 13);
export function hourKeys(start, n) {
  return Array.from({ length: n }, (_, i) => hourKey(new Date(start.getTime() + i * 3600e3)));
}
export const round = (x, d = 1) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
export const num = v => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
