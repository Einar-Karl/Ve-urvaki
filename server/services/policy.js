// What guests are offered when a tour is at risk or cancelled, edited in the admin page (config/policy.json).
// This file decides the *offers*; it is not legal advice. Check refund/credit wording with your own
// terms and local consumer rules before enabling "refund".
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = () => process.env.POLICY_FILE || fileURLToPath(new URL('../../config/policy.json', import.meta.url));

export const DEFAULT_POLICY = {
  offer: { rebook: true, switch: true, credit: true, refund: true, keep: true },
  // Auto-approve only makes sense once the follow-up (moving the booking, issuing the voucher, refunding)
  // is automated. Until Bókun write-back exists, leave these off so a person confirms each request.
  autoApprove: { rebook: false, switch: false, credit: false, refund: false, keep: true },
  creditBonusPct: 10,
  creditValidMonths: 12,
  rebookWindowDays: 14,
  linkValidDays: 30,
  retentionDays: 90,
  channels: 'both',                    // both | sms | email
  responseHours: 4,                    // shown to guests: "we confirm within N hours"
  messageSendHour: { from: 7, to: 21 } // advisory: admin warns when sending outside these UTC hours
};

export function getPolicy() {
  const f = FILE();
  if (!existsSync(f)) return structuredClone(DEFAULT_POLICY);
  try {
    const v = JSON.parse(readFileSync(f, 'utf8'));
    return { ...DEFAULT_POLICY, ...v, offer: { ...DEFAULT_POLICY.offer, ...v.offer }, autoApprove: { ...DEFAULT_POLICY.autoApprove, ...v.autoApprove }, messageSendHour: { ...DEFAULT_POLICY.messageSendHour, ...v.messageSendHour } };
  } catch { return structuredClone(DEFAULT_POLICY); }
}

export function savePolicy(patch) {
  const cur = getPolicy();
  const next = { ...cur, ...patch, offer: { ...cur.offer, ...patch.offer }, autoApprove: { ...cur.autoApprove, ...patch.autoApprove } };
  const nums = ['creditBonusPct', 'creditValidMonths', 'rebookWindowDays', 'linkValidDays', 'retentionDays', 'responseHours'];
  for (const k of nums) if (!Number.isFinite(+next[k]) || +next[k] < 0) throw new Error(`${k} must be a number ≥ 0`);
  for (const k of nums) next[k] = +next[k];
  if (next.creditBonusPct > 100) throw new Error('creditBonusPct must be between 0 and 100');
  if (!['both', 'sms', 'email'].includes(next.channels)) throw new Error('channels must be both, sms or email');
  const f = FILE();
  writeFileSync(f + '.tmp', JSON.stringify(next, null, 2) + '\n');
  renameSync(f + '.tmp', f);
  return next;
}
