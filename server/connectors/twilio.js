// SMS through Twilio. Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and either TWILIO_FROM (a number, or an
// alphanumeric sender id such as "ArcticAdv" where the destination country allows it) or
// TWILIO_MESSAGING_SERVICE_SID. Nothing is sent unless MESSAGING_MODE=live (see services/messaging.js).
import { postForm, getJson } from '../lib/http.js';

const sid = () => process.env.TWILIO_ACCOUNT_SID, tok = () => process.env.TWILIO_AUTH_TOKEN;
const auth = () => ({ Authorization: 'Basic ' + Buffer.from(`${sid()}:${tok()}`).toString('base64') });

export default {
  id: 'twilio',
  label: 'Twilio · SMS',
  kinds: ['sms'],
  license: 'Twilio terms; you are responsible for sender registration and consent rules',
  attribution: '',
  configured: () => !!(sid() && tok() && (process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID)),
  async sms({ to, text }) {
    const form = { To: to, Body: text, ...(process.env.TWILIO_MESSAGING_SERVICE_SID ? { MessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID } : { From: process.env.TWILIO_FROM }) };
    const r = await postForm(`https://api.twilio.com/2010-04-01/Accounts/${sid()}/Messages.json`, form, { headers: auth(), timeout: 15000 });
    return { providerId: r.sid, status: r.status };
  },
  async ping() {
    if (!this.configured()) throw Object.assign(new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM not set'), { unconfigured: true });
    const r = await getJson(`https://api.twilio.com/2010-04-01/Accounts/${sid()}.json`, { headers: auth() });
    return `account ${r.friendly_name || r.sid}: ${r.status}`;
  },
};
