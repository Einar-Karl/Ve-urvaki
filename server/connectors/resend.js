// Email through Resend (https://resend.com). Needs RESEND_API_KEY and EMAIL_FROM, e.g.
// "Arctic Adventures <bookings@arcticadventures.is>" on a domain verified in Resend (SPF/DKIM).
// Nothing is sent unless MESSAGING_MODE=live (see services/messaging.js).
import { postJson, getJson } from '../lib/http.js';

const key = () => process.env.RESEND_API_KEY;
const hdr = () => ({ Authorization: `Bearer ${key()}` });

export default {
  id: 'resend',
  label: 'Resend · email',
  kinds: ['email'],
  license: 'Resend terms; you are responsible for sender-domain verification',
  attribution: '',
  configured: () => !!(key() && process.env.EMAIL_FROM),
  async email({ to, subject, text, html, replyTo }) {
    const r = await postJson('https://api.resend.com/emails', { from: process.env.EMAIL_FROM, to: [to], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }, { headers: hdr(), timeout: 15000 });
    return { providerId: r.id, status: 'queued' };
  },
  async ping() {
    if (!this.configured()) throw Object.assign(new Error('RESEND_API_KEY / EMAIL_FROM not set'), { unconfigured: true });
    const r = await getJson('https://api.resend.com/domains', { headers: hdr() });
    const d = r.data || [];
    return `${d.length} domain(s): ${d.map(x => `${x.name} (${x.status})`).join(', ') || 'none verified yet'}`;
  },
};
