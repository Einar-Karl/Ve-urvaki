import crypto from 'node:crypto';
export const newToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = x => crypto.createHash('sha256').update(String(x)).digest('hex');
export const newId = (prefix = '') => prefix + crypto.randomBytes(9).toString('base64url');
export const safeEq = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
// Voucher codes avoid look-alike characters (0/O, 1/I): VV-7K3P-9XQM
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const voucherCode = () => { const b = crypto.randomBytes(8); const c = [...b].map(x => ALPHA[x % ALPHA.length]).join(''); return `VV-${c.slice(0, 4)}-${c.slice(4)}`; };
