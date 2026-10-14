// End-to-end tests of the guest flow, admin API, partner API and messaging. All state lives in temp dirs;
// all network calls are faked. The risk engine is the dashboard's own code running in a sandbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'vv3-'));
Object.assign(process.env, {
  STORE_DIR: `${tmp}/store/`, INGEST_DIR: `${tmp}/ingest/`, SETTINGS_FILE: `${tmp}/settings.json`, POLICY_FILE: `${tmp}/policy.json`,
  TOURS_FILE: `${tmp}/tours.json`, MODEL_FILE: `${tmp}/model.json`, DATA_MODE: 'demo', PUBLIC_BASE_URL: 'https://vedur.example.is',
});
delete process.env.MESSAGING_MODE; delete process.env.DASHBOARD_PASSWORD; delete process.env.ADMIN_PASSWORD; delete process.env.INGEST_TOKEN;
copyFileSync(new URL('../config/tours.json', import.meta.url), process.env.TOURS_FILE);

const { setFetch } = await import('../server/lib/http.js');
const { clearCache } = await import('../server/lib/cache.js');
const { STRINGS, t } = await import('../server/lib/i18n.js');
const msg = await import('../server/services/messaging.js');
const cases = await import('../server/services/cases.js');
const guests = await import('../server/services/guests.js');
const { saveSettings } = await import('../server/lib/settings.js');
const { savePolicy } = await import('../server/services/policy.js');
const { getRiskContext, resetRiskContext } = await import('../server/services/riskctx.js');
const { append } = await import('../server/services/ingest.js');
const { createServer } = await import('../server/index.js');
const { limited } = await import('../server/routes.js');
const { col } = await import('../server/lib/store.js');

setFetch(async () => { throw new Error('blocked'); });
saveSettings({ brand: { name: 'Arctic Adventures', phone: '+3545551234', email: 'hello@arctic.example' } });

const iso = (dayOffset, h) => { const d = new Date(); d.setUTCHours(h, 0, 0, 0); return new Date(d.getTime() + dayOffset * 86400e3).toISOString(); };
const DEP = iso(1, 9);                       // tomorrow 09:00, tour 2 departs at 09:00
const guest = (o = {}) => ({ ref: 'AA-1001', tourId: 2, departure: DEP, pax: 4, name: 'Anna Schmidt', email: 'anna@example.com', phone: '+4915112345678', lang: 'de', paidISK: 67600, ...o });

test('i18n: every English string exists in German and Icelandic, with the same placeholders', () => {
  for (const lang of ['de', 'is']) for (const [k, v] of Object.entries(STRINGS.en)) {
    assert.ok(STRINGS[lang][k], `${lang} is missing "${k}"`);
    const ph = s => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(ph(STRINGS[lang][k]), ph(v), `${lang}.${k} placeholders differ`);
  }
  assert.equal(t('de', 'hello', { name: 'Anna' }), 'Hallo Anna,');
  assert.equal(t('xx', 'hello', { name: 'A' }), 'Hi A,');   // unknown language falls back to English
});

test('messages: warning/cancelled in each language include link, tour and reason; HTML is escaped', () => {
  for (const lang of ['en', 'de', 'is']) for (const kind of ['warning', 'cancelled']) {
    const m = msg.compose(kind, { lang, guest: { name: 'Anna S' }, tourName: 'Glacier <hike>', departure: DEP, link: 'https://x/g/abc', deadlineIso: iso(0, 18), reason: { code: 'wind', gust: 25.3, limit: 22 } });
    for (const s of [m.sms.text, m.email.text]) { assert.match(s, /https:\/\/x\/g\/abc/); assert.ok(!/\{\w+\}/.test(s), `unreplaced placeholder in ${lang}/${kind}: ${s}`); }
    assert.match(m.email.text, /25/); assert.ok(m.email.html.includes('Glacier &lt;hike&gt;') || !m.email.html.includes('<hike>'));
  }
});

test('delivery: dry-run stores but never sends; live sends via Twilio and Resend with correct requests; failures are recorded', async () => {
  const g = { ref: 'R1', name: 'A', phone: '+3545551234', email: 'a@example.com' };
  const composed = msg.compose('warning', { lang: 'en', guest: g, tourName: 'T', departure: DEP, link: 'https://x/g/1', deadlineIso: iso(0, 18), reason: { code: 'generic' } });
  let calls = 0; setFetch(async () => { calls++; throw new Error('should not be called'); });
  const dry = await msg.deliver({ caseId: 'c1', kind: 'warning', guest: g, composed, lang: 'en' });
  assert.deepEqual(dry.map(r => r.status), ['dry-run', 'dry-run']); assert.equal(calls, 0);

  Object.assign(process.env, { MESSAGING_MODE: 'live', TWILIO_ACCOUNT_SID: 'ACxx', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: 'ArcticAdv', RESEND_API_KEY: 're_1', EMAIL_FROM: 'Arctic <b@arctic.example>' });
  const seen = [];
  setFetch(async (u, o) => { seen.push({ u: String(u), o }); return { ok: true, status: 200, json: async () => ({ sid: 'SM1', id: 'em_1', status: 'queued' }), text: async () => '' }; });
  const live = await msg.deliver({ caseId: 'c1', kind: 'warning', guest: g, composed, lang: 'en' });
  assert.deepEqual(live.map(r => `${r.channel}:${r.status}:${r.provider}`), ['sms:sent:twilio', 'email:sent:resend']);
  const tw = seen.find(x => x.u.includes('twilio')), rs = seen.find(x => x.u.includes('resend'));
  assert.match(tw.u, /Accounts\/ACxx\/Messages\.json$/); assert.equal(tw.o.method, 'POST');
  assert.equal(tw.o.headers.Authorization, 'Basic ' + Buffer.from('ACxx:tok').toString('base64'));
  const form = new URLSearchParams(tw.o.body); assert.equal(form.get('To'), '+3545551234'); assert.equal(form.get('From'), 'ArcticAdv'); assert.match(form.get('Body'), /x\/g\/1/);
  const em = JSON.parse(rs.o.body); assert.deepEqual(em.to, ['a@example.com']); assert.equal(em.from, 'Arctic <b@arctic.example>'); assert.ok(em.html && em.text && em.subject);
  assert.equal(rs.o.headers.Authorization, 'Bearer re_1');

  setFetch(async () => ({ ok: false, status: 400, text: async () => 'bad number', json: async () => ({}) }));
  const failed = await msg.deliver({ caseId: 'c1', kind: 'warning', guest: g, composed, lang: 'en' });
  assert.ok(failed.every(r => r.status === 'failed' && /400/.test(r.error)));
  for (const k of ['MESSAGING_MODE', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'RESEND_API_KEY', 'EMAIL_FROM']) delete process.env[k];
  setFetch(async () => { throw new Error('blocked'); });
});

test('guests: validation, phone normalisation (Icelandic local numbers), erasure removes everything', async () => {
  assert.equal(guests.normalizePhone('555 1234'), '+3545551234'); assert.equal(guests.normalizePhone('0049 151 1234567'), '+491511234567');
  assert.match(guests.validateGuest({ ...guest(), email: '', phone: '' }), /email or phone/);
  assert.match(guests.validateGuest({ ...guest(), phone: '12' }), /international/);
  const r = guests.upsertGuests([guest(), guest({ ref: 'BB-2', name: 'Bob', email: 'bob@example.com', phone: '', lang: 'en', pax: 2, paidISK: null })]);
  assert.equal(r.accepted, 2);
  assert.equal(guests.upsertGuests([guest({ name: 'Anna S.' })]).accepted, 1);           // same booking+departure: updated, not duplicated
  assert.equal(guests.listGuests({ tourId: 2, departure: DEP }).length, 2);
});

test('flow: prepare → preview → send (dry-run) → guest page → choose → ops approve → confirmation', async () => {
  resetRiskContext(); clearCache();
  const ctx = await getRiskContext({ mode: 'demo' });
  assert.equal(ctx.forecastMode, 'demo');
  const prep = cases.prepareCases({ tourId: 2, departure: DEP, kind: 'warning', who: 'tester', ctx });
  assert.equal(prep.created.length, 2);
  assert.equal(cases.prepareCases({ tourId: 2, departure: DEP, kind: 'warning', ctx }).created.length, 0, 'no duplicate cases');
  const c = prep.created.find(x => x.ref === 'AA-1001');
  const pv = cases.preview(c);
  assert.equal(pv.lang, 'de'); assert.match(pv.sms, new RegExp(`/g/${c.token}`)); assert.match(pv.email.subject, /Tour|Jöklaganga/);

  const recs = await cases.sendCase(c.id, 'tester');
  assert.deepEqual(recs.map(r => r.status), ['dry-run', 'dry-run']);
  assert.equal(col('cases').get(c.id).state, 'sent');

  const v = await cases.guestView(c.token, { ctx });
  assert.equal(v.lang, 'de'); assert.equal(v.guest.firstName, 'Anna'); assert.equal(v.strings.confirm_btn, 'Bestätigen');
  assert.ok(v.options.credit && v.options.refund); assert.equal(v.options.credit.valueISK, Math.round(67600 * 1.1)); assert.equal(v.options.refund.amountISK, 67600);
  for (const a of v.options.rebook) { assert.equal(String(a.tourId), '2'); assert.notEqual(a.departure, DEP); assert.notEqual(a.outlook, 'poor'); assert.ok(a.seatsLeft == null || a.seatsLeft >= 4); }
  for (const a of v.options.switch) { assert.notEqual(String(a.tourId), '2'); assert.notEqual(a.outlook, 'unknown'); }
  assert.equal(v.choice, null);

  const pick = v.options.rebook[0];
  assert.ok(pick, 'demo data offers at least one alternative date');
  await assert.rejects(() => cases.choose(c.token, { type: 'rebook', departure: iso(1, 3) }, { ctx }), /no longer available/);   // not an offered date
  const after = await cases.choose(c.token, { type: 'rebook', departure: pick.departure }, { ctx });
  assert.equal(after.choice.status, 'pending'); assert.equal(after.choice.departure, pick.departure);
  assert.ok(col('outbox').all().some(m => m.caseId === c.id && m.kind === 'confirm'));

  await cases.choose(c.token, { type: 'refund' }, { ctx });                               // guest may change their mind while pending
  assert.equal(col('cases').get(c.id).choice.type, 'refund'); assert.equal(col('cases').get(c.id).history.length, 1);

  await cases.resolve(c.id, 'approve', 'ok', 'anna@ops');
  assert.equal(col('cases').get(c.id).choice.status, 'approved');
  assert.ok(col('outbox').all().some(m => m.caseId === c.id && m.kind === 'approved'));
  await assert.rejects(() => cases.choose(c.token, { type: 'keep' }, { ctx }), e => e.code === 409);      // locked once approved
  assert.match(cases.listCases({ choiceStatus: 'approved' })[0].todo, /Refund 67600 ISK/);
  await cases.resolve(c.id, 'done', '', 'anna@ops');
  assert.equal(col('cases').get(c.id).state, 'closed');
});

test('flow: credit approval issues a voucher once; "keep" only for warnings; invalid / expired tokens are not found', async () => {
  const ctx = await getRiskContext({ mode: 'demo' });
  const cancelled = cases.prepareCases({ tourId: 2, departure: DEP, kind: 'cancelled', ctx }).created.find(x => x.ref === 'BB-2');
  assert.ok(cancelled, 'a cancelled-kind case is created for Bob');
  await assert.rejects(() => cases.choose(cancelled.token, { type: 'keep' }, { ctx }), /not available/);
  await cases.choose(cancelled.token, { type: 'credit' }, { ctx });
  await cases.resolve(cancelled.id, 'approve', '', 'ops'); await cases.resolve(cancelled.id, 'approve', '', 'ops');
  const vs = cases.listVouchers().filter(v => v.caseId === cancelled.id);
  assert.equal(vs.length, 1); assert.match(vs[0].code, /^VV-[A-Z2-9]{4}-[A-Z2-9]{4}$/); assert.equal(vs[0].valueISK, Math.round(2 * 16900 * 1.1));
  const v = await cases.guestView(cancelled.token, { ctx }); assert.equal(v.choice.voucherCode, vs[0].code);
  assert.equal(await cases.guestView('nope', { ctx }), null);
  assert.equal(await cases.guestView(cancelled.token, { ctx, nowMs: Date.parse(DEP) + 40 * 86400e3 }), null);   // past linkValidDays
  await assert.rejects(() => cases.choose('nope', { type: 'refund' }, { ctx }), e => e.code === 404);
});

test('seat accounting: full departures are not offered, and seats promised to other guests are held', async () => {
  const ctx = await getRiskContext({ mode: 'demo' });
  const g = guests.listGuests({ tourId: 2, departure: DEP }).find(x => x.ref === 'BB-2');
  const c = cases.prepareCases({ tourId: 2, departure: DEP, kind: 'warning', ctx }).created[0] || col('cases').find(x => x.ref === 'BB-2')[0];
  const before = (await cases.alternatives(c, g, ctx)).rebook;
  assert.ok(before.length);
  const target = before[0];
  append('bookings', { tourId: 2, departure: target.departure, pax: 63, capacity: 64 });          // 1 seat left, guest needs 2
  clearCache();
  const after = (await cases.alternatives(c, g, ctx)).rebook;
  assert.ok(!after.some(a => a.departure === target.departure), 'a departure with too few seats is hidden');
});

test('HTTP: guest endpoints are public, admin is separate, CSRF and rate limits hold, partner keys are scoped', async () => {
  Object.assign(process.env, { DASHBOARD_PASSWORD: 'dash', ADMIN_PASSWORD: 'adm' });
  const srv = createServer(); await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const basic = (u, p) => ({ Authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });
  const J = { 'content-type': 'application/json' };
  try {
    const open = cases.listCases()[0];
    const tok = col('cases').get(open.id).token;
    assert.equal((await fetch(`${base}/g/${tok}`)).status, 200);                                    // guest page, no login
    assert.equal((await fetch(`${base}/api/guest/${tok}`)).status, 200);
    assert.equal((await fetch(`${base}/api/guest/not-a-token`)).status, 404);
    assert.equal((await fetch(`${base}/api/admin/overview`, { headers: basic('arctic', 'dash') })).status, 401);   // dashboard login is not admin
    assert.equal((await fetch(`${base}/api/admin/overview`, { headers: basic('admin', 'adm') })).status, 200);
    assert.equal((await fetch(`${base}/api/guest/${tok}`, { headers: basic('x', 'y') })).status, 200);
    assert.equal((await fetch(`${base}/api/admin/tours`, { method: 'PUT', body: '{"tours":[]}', headers: { ...basic('admin', 'adm'), 'content-type': 'text/plain' } })).status, 415);

    const k = await (await fetch(`${base}/api/admin/keys`, { method: 'POST', body: JSON.stringify({ name: 'Zapier', scopes: ['ingest'] }), headers: { ...basic('admin', 'adm'), ...J } })).json();
    assert.match(k.key, /^vv_/); assert.equal(k.hash, undefined);
    const tourBody = JSON.stringify({ id: 99, name: 'Partner tour', type: 'hike', lat: 64.1, lon: -21.9, departures: ['10:00'], durationHours: 2, capacity: 10, priceISK: 5000 });
    assert.equal((await fetch(`${base}/api/partner/tours`, { method: 'PUT', body: tourBody, headers: { 'x-api-key': k.key, ...J } })).status, 401);   // ingest scope cannot edit tours
    assert.equal((await fetch(`${base}/api/ingest/guests`, { method: 'POST', body: JSON.stringify(guest({ ref: 'ZZ-9' })), headers: { 'x-api-key': k.key } })).status, 202);
    assert.equal((await fetch(`${base}/api/ingest/guests`, { headers: { 'x-api-key': k.key } })).status, 405);   // key holders cannot read guests back
    assert.equal((await fetch(`${base}/api/admin/overview`, { headers: { 'x-api-key': k.key } })).status, 401);
    const k2 = await (await fetch(`${base}/api/admin/keys`, { method: 'POST', body: JSON.stringify({ name: 'Partner', scopes: ['tours'] }), headers: { ...basic('admin', 'adm'), ...J } })).json();
    const put = await fetch(`${base}/api/partner/tours`, { method: 'PUT', body: tourBody, headers: { 'x-api-key': k2.key, ...J } });
    assert.equal(put.status, 200);
    assert.ok((await (await fetch(`${base}/api/partner/tours`, { headers: { 'x-api-key': k2.key } })).json()).tours.some(t => t.id === 99));
    const bad = await fetch(`${base}/api/partner/tours`, { method: 'PUT', body: JSON.stringify({ id: 100, name: 'x', type: 'bogus' }), headers: { 'x-api-key': k2.key, ...J } });
    assert.equal(bad.status, 422);
    await fetch(`${base}/api/admin/keys/${k2.id}`, { method: 'DELETE', headers: basic('admin', 'adm') });
    assert.equal((await fetch(`${base}/api/partner/tours`, { headers: { 'x-api-key': k2.key } })).status, 401);   // revoked
    assert.ok((await (await fetch(`${base}/api/admin/keys`, { headers: basic('admin', 'adm') })).json()).every(x => !x.hash && !x.key));
  } finally { srv.close(); delete process.env.DASHBOARD_PASSWORD; delete process.env.ADMIN_PASSWORD; }
  assert.equal(limited('1.2.3.4', 3, 1000) || limited('1.2.3.4', 3, 1001) || limited('1.2.3.4', 3, 1002), false);
  assert.equal(limited('1.2.3.4', 3, 1003), true);
  assert.equal(limited('1.2.3.4', 3, 1003 + 61e3), false);
});

test('admin API: tours CSV import preview/apply, departures list, guests CSV, retention and erasure', async () => {
  const srv = createServer(); await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`, J = { 'content-type': 'application/json' };
  const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', body: JSON.stringify(b), headers: J }).then(r => r.json());
  try {
    const csv = 'id;name;type;lat;lon;departures;durationHours;capacity;priceISK;bokunProductId;roads\r\n201;Test hike;hike;63,53;-19,35;09:00|13:00;3;40;16900;777;Hringvegur|Þórsmerkurvegur\r\n202;Broken;nope;1;1;09:00;3;5;100;;\r\n';
    const prev = await post('/api/admin/tours/import', { csv });
    assert.equal(prev.preview.length, 1); assert.equal(prev.errors.length, 1); assert.deepEqual(prev.preview[0].departures, ['09:00', '13:00']); assert.deepEqual(prev.preview[0].roads, ['Hringvegur', 'Þórsmerkurvegur']);
    assert.equal(prev.preview[0].lat, 63.53);
    const dep = await (await fetch(`${base}/api/admin/departures`)).json();
    assert.ok(dep.departures.length > 0 && dep.departures.every(d => d.deadline));
    const gi = await post('/api/admin/guests/import?apply=1', { csv: 'ref;tourId;departure;pax;name;email;phone;lang;paidISK\r\nCC-3;2;' + DEP + ';2;Carl;carl@example.com;;en;33800\r\n' });
    assert.equal(gi.accepted, 1);
    const badImport = await fetch(`${base}/api/admin/guests/import?apply=1`, { method: 'POST', headers: J, body: JSON.stringify({ csv: 'ref;tourId;departure;pax\r\nX;2;nope;1\r\n' }) });
    assert.equal(badImport.status, 422);
    const er = await (await fetch(`${base}/api/admin/guests/CC-3`, { method: 'DELETE' })).json();
    assert.equal(er.guests, 1); assert.equal(guests.listGuests().filter(g => g.ref === 'CC-3').length, 0);
    const old = guests.upsertGuests([guest({ ref: 'OLD-1', departure: iso(-120, 9) })]); assert.equal(old.accepted, 1);
    assert.equal(guests.purgeExpired().refs >= 1, true); assert.equal(guests.listGuests().filter(g => g.ref === 'OLD-1').length, 0);
    const csvOut = await (await fetch(`${base}/api/admin/requests.csv`)).text(); assert.ok(csvOut.startsWith('case;booking'));   // (fetch strips the BOM)
    const s = await (await fetch(`${base}/api/admin/overview`)).json(); assert.equal(s.messagingMode, 'dry-run'); assert.ok(s.counts.tours >= 12);
    const toggled = await fetch(`${base}/api/admin/connectors/openweather`, { method: 'PUT', headers: J, body: JSON.stringify({ enabled: false }) }); assert.equal(toggled.status, 200);
    assert.ok(JSON.parse(readFileSync(process.env.SETTINGS_FILE, 'utf8')).disabledConnectors.includes('openweather'));
    assert.equal((await fetch(`${base}/admin`)).status, 200);
  } finally { srv.close(); }
});

test('risk engine: a closed access road overrides the weather within 24 h (same code as the dashboard)', async () => {
  const { makeRisk } = await import('../server/services/risk.js');
  const { getForecast } = await import('../server/services/forecast.js');
  const { readTours } = await import('../server/lib/sites.js');
  const forecast = await getForecast({ mode: 'demo' }), { tours, warnings } = readTours();
  const calm = makeRisk({ forecast, tours, warnings });
  const blocked = makeRisk({ forecast, tours, warnings, roads: { configured: true, blocked: { 2: ['Þórsmerkurvegur'] } } });
  const soon = new Date(calm.nowMs + 3 * 3600e3).toISOString();
  assert.ok(blocked.riskAt(2, soon).cancel >= 0.9); assert.deepEqual(blocked.riskAt(2, soon).road, ['Þórsmerkurvegur']);
  assert.ok(calm.riskAt(2, soon).cancel < 0.9 || calm.riskAt(2, soon).road === undefined);
  assert.equal(blocked.riskAt(2, new Date(calm.nowMs + 40 * 3600e3).toISOString()).road, undefined);   // beyond 24 h the road state is not assumed
  assert.equal(calm.riskAt(2, new Date(calm.startMs + 200 * 3600e3).toISOString()), null);              // outside the forecast window
});
