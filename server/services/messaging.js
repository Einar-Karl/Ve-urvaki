// Composes and delivers guest messages (SMS + email), in the guest's language.
//
// SAFETY: MESSAGING_MODE defaults to "dry-run": messages are rendered and stored in the outbox
// (visible in the admin page) but NOT sent. Set MESSAGING_MODE=live, with a configured provider
// (Twilio for SMS, Resend for email), to actually send. Every attempt is logged in the outbox.
import { col } from '../lib/store.js';
import { newId } from '../lib/tokens.js';
import { t, when, plural } from '../lib/i18n.js';
import { getSettings } from '../lib/settings.js';
import { getPolicy } from './policy.js';
import { loadConnectors, withKind } from '../registry.js';

export const mode = () => (process.env.MESSAGING_MODE === 'live' ? 'live' : 'dry-run');
export const baseUrl = () => (process.env.PUBLIC_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
export const guestLink = token => `${baseUrl()}/g/${token}`;
const outbox = () => col('outbox');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function reasonText(lang, r = {}) {
  switch (r.code) {
    case 'wind': return t(lang, 'why_wind', { gust: Math.round(r.gust), limit: Math.round(r.limit ?? r.gust) });
    case 'rain': return t(lang, 'why_rain', { precip: String(Math.round(r.precip * 10) / 10).replace('.', ',') });
    case 'waves': return t(lang, 'why_waves', { waves: String(Math.round(r.waves * 10) / 10).replace('.', ',') });
    case 'cloud': return t(lang, 'why_cloud');
    case 'road': return t(lang, 'why_road', { road: r.road });
    default: return t(lang, 'why_generic');
  }
}

// kind: warning | cancelled | confirm | approved | rejected
export function compose(kind, c) {
  const { lang, guest, tourName, departure, link, deadlineIso, choiceText } = c;
  const s = getSettings(), brand = s.brand.name, phone = c.phone || s.brand.phone || '';
  const date = when(departure, lang);
  const time = deadlineIso ? new Date(deadlineIso).toISOString().slice(11, 16) : '';
  const v = { brand, tour: tourName, date, link, time, choice: choiceText || '', phone };
  const name = (guest.name || '').split(' ')[0] || '';
  const hello = name ? t(lang, 'hello', { name }) : null;
  const paras = [];
  const intro = t(lang, `msg_${kind}_intro`, v);
  paras.push(intro);
  if (kind === 'confirm' || kind === 'approved') paras.push(`${choiceText}`);
  if (kind === 'warning' || kind === 'cancelled') paras.push(reasonText(lang, c.reason));
  if (kind === 'warning' || kind === 'cancelled') paras.push(t(lang, `msg_${kind}_outro`, v));
  const cta = t(lang, `msg_${kind}_cta`, v);
  const hasCta = ['warning', 'cancelled', 'confirm'].includes(kind);
  const contact = phone ? t(lang, 'msg_contact', v) : '';

  const text = [hello, ...paras, hasCta ? `${cta}: ${link}` : null, '', t(lang, 'msg_signoff'), brand, contact].filter(x => x != null).join('\n\n').replace(/\n\n\n\n/g, '\n\n');
  const subject = t(lang, `msg_${kind}_subject`, v);
  const sms = t(lang, `msg_${kind}_sms`, v);
  return { sms: { text: sms }, email: { subject, text, html: renderEmail({ brand, color: s.brand.color, logoUrl: s.brand.logoUrl, hello, paras, cta: hasCta ? { label: cta, url: link } : null, signoff: t(lang, 'msg_signoff'), contact }) } };
}

export function renderEmail({ brand, color = '#0b5c70', logoUrl, hello, paras, cta, signoff, contact }) {
  const p = x => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#1c2a33">${esc(x)}</p>`;
  return `<!doctype html><html><body style="margin:0;background:#f3f5f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${esc(color)};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:600">${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(brand)}" height="28" style="vertical-align:middle">` : esc(brand)}</td></tr>
<tr><td style="padding:28px">${hello ? p(hello) : ''}${paras.map(p).join('')}
${cta ? `<p style="margin:24px 0"><a href="${esc(cta.url)}" style="display:inline-block;background:${esc(color)};color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 26px;border-radius:8px">${esc(cta.label)}</a></p>` : ''}
${p(signoff)}<p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#1c2a33">${esc(brand)}</p>
${contact ? `<p style="margin:0;font-size:13px;color:#6a7a84">${esc(contact)}</p>` : ''}</td></tr></table></td></tr></table></body></html>`;
}

// Deliver one composed message per channel the guest can be reached on. Returns the outbox records.
export async function deliver({ caseId, kind, guest, composed, lang, channels: only }) {
  const policy = getPolicy();
  const channels = only || (policy.channels === 'sms' ? ['sms'] : policy.channels === 'email' ? ['email'] : ['sms', 'email']);
  const list = await loadConnectors();
  const out = [];
  for (const ch of channels) {
    const to = ch === 'sms' ? guest.phone : guest.email;
    if (!to) continue;
    const msg = composed[ch];
    const rec = { id: newId('msg_'), caseId, ref: guest.ref, kind, channel: ch, to, lang, subject: msg.subject || null, text: msg.text, html: msg.html || null, mode: mode(), at: new Date().toISOString() };
    const provider = withKind(list, ch).find(p => p.configured());
    if (mode() !== 'live') { rec.status = 'dry-run'; rec.note = 'MESSAGING_MODE is dry-run: stored, not sent'; }
    else if (!provider) { rec.status = 'failed'; rec.error = `no ${ch} provider configured`; }
    else {
      try { const r = await provider[ch]({ to, ...msg, replyTo: getSettings().brand.email || undefined }); rec.status = 'sent'; rec.provider = provider.id; rec.providerId = r.providerId; }
      catch (e) { rec.status = 'failed'; rec.provider = provider.id; rec.error = e.message; }
    }
    outbox().put(rec);
    out.push(rec);
  }
  return out;
}

export const listOutbox = (limit = 200) => outbox().all().sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
export async function sendTest({ channel, to, lang = 'en' }) {
  const fake = { id: 'test', ref: 'TEST', name: 'Test Guest', phone: channel === 'sms' ? to : '', email: channel === 'email' ? to : '' };
  const composed = compose('warning', { lang, guest: fake, tourName: 'Test tour', departure: new Date(Date.now() + 86400e3).toISOString(), link: guestLink('test-link'), deadlineIso: new Date(Date.now() + 36e5).toISOString(), reason: { code: 'wind', gust: 24, limit: 22 } });
  return deliver({ caseId: 'test', kind: 'test', guest: fake, composed: { [channel]: composed[channel] }, lang, channels: [channel] });
}
export { plural };
