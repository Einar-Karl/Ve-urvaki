// Admin page. Plain JS, no build step. All text is inserted as text nodes (never innerHTML) so guest-supplied
// names, notes and messages cannot inject markup.
(() => {
  const $ = s => document.querySelector(s);
  const h = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'value') e.value = v; else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); } for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
  const pill = (cls, text, title) => h('span', { class: `pill p-${cls}`, title }, text);
  const dt = iso => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '–');
  const isk = n => (n == null || n === '' ? '–' : `${new Intl.NumberFormat('is-IS').format(Math.round(n))} kr.`);
  const pct = x => (x == null ? '–' : `${Math.round(x * 100)}%`);

  async function api(method, path, body, raw) {
    const r = await fetch(`/api/admin${path}`, { method, headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text(); let j; try { j = JSON.parse(text); } catch { j = text; }
    if (!r.ok) { const e = new Error((j && j.error) || `HTTP ${r.status}`); e.body = j; e.status = r.status; throw e; }
    return j;
  }
  const toast = (msg, err) => { const t = h('div', { class: `toast${err ? ' err' : ''}` }, msg); $('#toasts').append(t); setTimeout(() => t.remove(), err ? 7000 : 3500); };
  const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { const list = e.body && e.body.errors; toast(list ? `${e.message}: ${list.map(x => (typeof x === 'string' ? x : x.error || (x.errors && x.errors.join(', ')) || JSON.stringify(x))).slice(0, 4).join('; ')}` : e.message, true); return false; } };   // false keeps a dialog open so input is not lost

  function dialog(title, body, buttons = []) {
    const d = $('#dlg');
    d.replaceChildren(h('div', { class: 'dh' }, h('h2', {}, title), h('button', { class: 'btn sm', onclick: () => d.close() }, 'Close')), h('div', { class: 'db' }, body),
      buttons.length ? h('div', { class: 'df' }, buttons.map(b => h('button', { class: `btn ${b.primary ? 'primary' : ''}`, onclick: async () => { const keep = await b.run(); if (keep !== false) d.close(); } }, b.label))) : null);
    if (!d.open) d.showModal(); return d;
  }
  const field = (label, input, hint, full) => h('label', { class: `f${full ? ' full' : ''}` }, label, input, hint ? h('small', {}, hint) : null);
  const inp = (v, o = {}) => h('input', { value: v ?? '', ...o });
  const sel = (opts, v, o = {}) => { const s = h('select', o, Object.entries(opts).map(([k, n]) => h('option', { value: k }, n))); s.value = v ?? ''; return s; };
  const sw = (checked, onchange) => h('span', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!checked, onchange: e => onchange(e.target.checked) }), h('i'));
  const panel = (title, sub, actions, ...body) => h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', {}, title), sub ? h('span', { class: 'sub' }, sub) : null, actions ? h('span', { class: 'sp' }, actions) : null), ...body);
  const table = (cols, rows, empty = 'Nothing here yet.') => rows.length ? h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map(c => h('th', { class: c.num ? 'num' : '' }, c.h)))), h('tbody', {}, rows.map(r => h('tr', {}, cols.map(c => h('td', { class: c.num ? 'num' : '' }, c.f(r)))))))) : h('div', { class: 'empty' }, empty);
  const tabs = (items, cur, on) => h('div', { class: 'tabs' }, items.map(([k, l]) => h('button', { 'aria-pressed': String(k === cur), onclick: () => on(k) }, l)));
  let overviewCache = null;

  // ---------------------------------------------------------------- Overview
  async function overview() {
    const [o, s] = await Promise.all([api('GET', '/overview'), api('GET', '/settings')]);
    overviewCache = o; badge(o);
    const live = o.messagingMode === 'live', conn = id => o.connectors.find(c => c.id === id);
    const steps = [
      [!o.toursDemo, 'Add your real tours', 'Tours still hold the example list. Edit them under Tours (or import a CSV).', 'tours'],
      [o.auth.dashboardPassword || o.auth.adminPassword, 'Protect the dashboard and this page', 'Set DASHBOARD_PASSWORD (and ADMIN_PASSWORD) in .env on the server.', null],
      [o.publicBaseUrl && !/localhost/.test(o.publicBaseUrl), 'Set the public web address', 'Set PUBLIC_BASE_URL (e.g. https://vedur.arcticadventures.is). Guest messages link to it.', null],
      [conn('bokun') && conn('bokun').configured, 'Connect bookings', 'Set BOKUN_ACCESS_KEY and BOKUN_SECRET_KEY, or import booking snapshots.', 'connections'],
      [o.counts.guests > 0, 'Add guest contact details', 'Guests need an email or phone to be warned. Import a CSV or push them from your booking system.', 'guests'],
      [(conn('twilio') && conn('twilio').configured) || (conn('resend') && conn('resend').configured), 'Configure SMS and/or email sending', 'Set the Twilio and/or Resend keys in .env.', 'connections'],
      [live, 'Switch messaging to live', 'Messaging is in dry-run: nothing is sent until MESSAGING_MODE=live.', 'activity'],
      [s.brand.phone || s.brand.email, 'Add contact details for guests', 'Phone / email shown to guests who need help. Set them under Settings.', 'settings'],
    ];
    return [
      h('div', { class: `banner ${live ? 'good' : 'warn'}` }, h('div', {}, h('b', {}, live ? 'Guest messaging is LIVE' : 'Guest messaging is in DRY-RUN'), h('p', {}, live ? 'Messages are really sent by SMS and email.' : 'Messages are created and stored in the outbox so you can review them, but nothing is sent. Set MESSAGING_MODE=live on the server when ready.'))),
      h('div', { class: 'grid' },
        [['Tours', o.counts.tours, o.toursDemo ? 'example data' : 'configured'], ['Guests on file', o.counts.guests, 'contact details'], ['Awaiting guest reply', o.counts.awaitingGuest, 'notified, no choice yet'], ['Needs your action', o.counts.pending + o.counts.approved, `${o.counts.pending} new · ${o.counts.approved} to do`]].map(([l, v, n]) => h('div', { class: 'stat' }, h('div', { class: 'l' }, l), h('div', { class: 'v' }, v), h('div', { class: 'n' }, n)))),
      panel('Setup progress', `${steps.filter(x => x[0]).length} of ${steps.length} done`, null, h('div', { class: 'pb' }, h('ul', { class: 'steps' }, steps.map(([ok, t, d, go]) => h('li', { class: ok ? 'done' : '' }, h('span', { class: 'dot' }, ok ? '✓' : '·'), h('div', {}, h('b', {}, t), h('span', {}, d)), !ok && go ? h('a', { class: 'btn sm', style: 'margin-left:auto', href: `#${go}` }, 'Open') : null))))),
    ];
  }
  function badge(o) {
    const n = o.counts.pending + o.counts.approved, a = document.querySelector('#nav a[data-id=requests]');
    if (a) { const old = a.querySelector('.n'); if (old) old.remove(); if (n) a.append(h('span', { class: 'n' }, n)); }
    const m = $('#mode'); m.textContent = o.messagingMode === 'live' ? 'Messaging live' : 'Messaging dry-run'; m.className = `chip ${o.messagingMode === 'live' ? 'live' : 'dry'}`;
  }

  // ---------------------------------------------------------------- Notifications
  async function notifications() {
    let filter = 'risk'; const wrap = h('div', { style: 'display:grid;gap:18px' });
    const data = await api('GET', '/departures');
    const draw = () => {
      const rows = data.departures.filter(d => filter === 'all' || (d.cancel ?? 0) >= 0.2 || d.road);
      const risk = d => (d.cancel == null ? pill('muted', 'no forecast') : pill(d.cancel >= .5 ? 'bad' : d.cancel >= .2 ? 'warn' : 'go', pct(d.cancel)));
      wrap.replaceChildren(
        data.forecastMode !== 'live' ? h('div', { class: 'banner warn' }, h('div', {}, h('b', {}, 'Risk is based on demo or missing forecast data'), h('p', {}, 'Check Connections. Do not message real guests from demo risk values.'))) : null,
        panel('Upcoming departures', 'sorted by risk · decide, prepare, review, then send', tabs([['risk', 'At risk'], ['all', 'All departures']], filter, k => { filter = k; draw(); }),
          table([{ h: 'Tour', f: d => h('div', {}, h('b', {}, d.tourName), d.road ? h('div', { class: 'small' }, pill('bad', 'road closed'), ' ', d.road.join(', ')) : null) }, { h: 'Departure', f: d => dt(d.departure) }, { h: 'Cancel risk', f: risk },
            { h: 'Decide by', f: d => dt(d.deadline) }, { h: 'Guests', f: d => d.guests ? `${d.guests} bookings · ${d.guestPax} pax${d.reachable < d.guests ? ` (${d.guests - d.reachable} unreachable)` : ''}` : h('span', { class: 'muted' }, 'none on file') },
            { h: 'Messages', f: d => d.cases ? `${d.casesSent}/${d.cases} sent` : '–' },
            { h: '', f: d => h('div', { class: 'row' }, h('button', { class: 'btn sm', disabled: !d.guests, title: d.guests ? '' : 'No guests with contact details on file for this departure', onclick: () => prepare(d, 'warning') }, 'Prepare warning'), h('button', { class: 'btn sm danger', disabled: !d.guests, onclick: () => prepare(d, 'cancelled') }, 'Prepare cancellation')) }], rows, 'No departures at risk right now.')));
    };
    const prepare = guard(async (d, kind) => {
      const r = await api('POST', '/cases/prepare', { tourId: d.tourId, departure: d.departure, kind });
      const total = r.created + r.existing;
      const dlg = dialog(`${kind === 'warning' ? 'Warning' : 'Cancellation'} · ${d.tourName} · ${dt(d.departure)}`,
        h('div', {}, h('p', {}, `${r.created} new message set(s) prepared${r.existing ? `, ${r.existing} already existed` : ''}. Review before sending:`),
          r.previews.filter(Boolean).map(p => h('div', {}, h('div', { class: 'small muted' }, `To ${p.guest.name || 'guest'} · language ${p.lang}`), h('div', { class: 'msgbox' }, h('b', {}, 'SMS'), p.sms), h('div', { class: 'msgbox' }, h('b', {}, `Email · ${p.email.subject}`), p.email.text))),
          total > 3 ? h('p', { class: 'muted small' }, `…and ${total - 3} more, written the same way in each guest's language.`) : null),
        [{ label: 'Close', run: () => true }, { label: `Send to ${total} guest(s)${overviewCache && overviewCache.messagingMode !== 'live' ? ' (dry-run)' : ' now'}`, primary: true, run: guard(async () => {
          const live = overviewCache && overviewCache.messagingMode === 'live';
          if (live && !confirm(`This will really send SMS/email to ${total} guest(s). Continue?`)) return false;
          const s = await api('POST', '/cases/send', { ids: r.cases });
          const failed = s.results.filter(x => !x.ok || x.messages.some(m => m.status === 'failed')).length;
          toast(`${s.mode === 'live' ? 'Sent' : 'Stored in outbox (dry-run)'}: ${s.results.length - failed} ok${failed ? `, ${failed} with problems (see Activity)` : ''}`, !!failed);
          notifications().then(render => { $('#view').replaceChildren(render); });
        }) }]);
      return dlg;
    });
    draw(); return wrap;
  }

  // ---------------------------------------------------------------- Requests
  async function requests() {
    let f = 'action'; const wrap = h('div', { style: 'display:grid;gap:18px' });
    const load = async () => { const [cs, vs] = await Promise.all([api('GET', '/cases'), api('GET', '/vouchers')]); draw(cs, vs); api('GET', '/overview').then(badge); };
    const act = guard(async (c, action, ask) => { const note = ask ? prompt(ask) : ''; if (ask && note === null) return; await api('POST', `/cases/${c.id}/resolve`, { action, note }); toast(`Marked ${action}`); load(); });
    const draw = (cs, vs) => {
      const shown = cs.filter(c => f === 'all' ? true : f === 'action' ? c.choice && ['pending', 'approved'].includes(c.choice.status) : f === 'waiting' ? !c.choice && c.state !== 'closed' : c.choice && ['done', 'rejected'].includes(c.choice.status));
      const choiceText = c => !c.choice ? h('span', { class: 'muted' }, c.state === 'prepared' ? 'not sent yet' : 'no reply yet') : h('div', {}, h('b', {}, { rebook: 'New date', switch: 'Other tour', credit: 'Voucher', refund: 'Refund', keep: 'Keep booking' }[c.choice.type]), c.choice.departure ? h('div', { class: 'small' }, `${c.choice.tourName || ''} ${dt(c.choice.departure)}`) : null, c.choice.amountISK ? h('div', { class: 'small' }, isk(c.choice.amountISK)) : null, c.choice.voucherCode ? h('div', { class: 'mono small' }, c.choice.voucherCode) : null);
      wrap.replaceChildren(
        panel('Guest requests', 'what guests chose, and what you need to do', [tabs([['action', 'Needs action'], ['waiting', 'Waiting for guest'], ['finished', 'Finished'], ['all', 'All']], f, k => { f = k; draw(cs, vs); }), h('a', { class: 'btn sm', href: '/api/admin/requests.csv' }, 'Export CSV')],
          table([{ h: 'Guest', f: c => h('div', {}, h('b', {}, c.guest ? c.guest.name || c.ref : c.ref), h('div', { class: 'small muted' }, `${c.ref} · ${c.guest ? c.guest.pax : '?'} pax`)) },
            { h: 'Departure', f: c => h('div', {}, c.tourName, h('div', { class: 'small muted' }, `${dt(c.departure)} · ${c.kind}`)) }, { h: 'Choice', f: choiceText },
            { h: 'Status', f: c => c.choice ? pill(c.choice.status, c.choice.status) : pill(c.state === 'closed' ? 'closed' : c.state === 'prepared' ? 'prepared' : 'muted', c.state) },
            { h: 'To do in your booking system', f: c => h('span', { class: 'small' }, c.todo || '–') },
            { h: '', f: c => h('div', { class: 'row' }, c.choice && c.choice.status === 'pending' ? [h('button', { class: 'btn sm primary', onclick: () => act(c, 'approve') }, 'Approve'), h('button', { class: 'btn sm danger', onclick: () => act(c, 'reject', 'Reason for rejecting (shown only to you):') }, 'Reject')] : null,
              c.choice && c.choice.status === 'approved' ? h('button', { class: 'btn sm primary', onclick: () => act(c, 'done', 'Note (optional, e.g. refund reference):') }, 'Mark done') : null,
              c.choice && c.choice.status !== 'done' ? h('button', { class: 'btn sm', onclick: () => act(c, 'reopen') }, 'Reopen') : null) }], shown, 'No requests in this view.')),
        panel('Vouchers issued', 'create these as promo codes in your booking system', null, table([{ h: 'Code', f: v => h('span', { class: 'mono' }, v.code) }, { h: 'Value', f: v => isk(v.valueISK) }, { h: 'Booking', f: v => v.ref }, { h: 'Issued', f: v => dt(v.createdAt) }, { h: 'Expires', f: v => dt(v.expiresAt) }], vs, 'No vouchers yet.')));
    };
    await load(); return wrap;
  }

  // ---------------------------------------------------------------- Tours
  const TYPES = { snow: 'Snowmobile', hike: 'Glacier hike', cave: 'Ice cave', snork: 'Snorkelling', aurora: 'Northern lights', whale: 'Whale watching', jeep: 'Super jeep', raft: 'Rafting', atv: 'ATV' };
  const REGIONS = { rvk: 'Capital area', rnes: 'Reykjanes', west: 'Snæfellsnes', hl: 'Langjökull', south: 'South', se: 'South-east', north: 'North' };
  async function tours() {
    const wrap = h('div', { style: 'display:grid;gap:18px' });
    const load = async () => draw(await api('GET', '/tours'));
    const draw = d => wrap.replaceChildren(
      d.demo ? h('div', { class: 'banner warn' }, h('div', {}, h('b', {}, 'These are example tours'), h('p', {}, 'Replace them with your real tours. Saving any change marks the list as real.'))) : null,
      d.warnings.length ? h('div', { class: 'banner bad' }, h('div', {}, h('b', {}, 'Problems in the tour list'), h('ul', {}, d.warnings.map(w => h('li', {}, w))))) : null,
      panel('Tours', `${d.tours.length} configured`, [h('button', { class: 'btn', onclick: importDlg }, 'Import CSV'), h('button', { class: 'btn primary', onclick: () => edit(null) }, 'Add tour')],
        table([{ h: 'ID', f: t => t.id }, { h: 'Tour', f: t => h('b', {}, t.name) }, { h: 'Type', f: t => TYPES[t.type] || t.type }, { h: 'Meeting point', f: t => `${t.lat}, ${t.lon}`, },
          { h: 'Departures', f: t => (t.departures || []).join(' · ') }, { h: 'Seats', num: 1, f: t => t.capacity }, { h: 'Price', num: 1, f: t => isk(t.priceISK) }, { h: 'Bókun', f: t => t.bokunProductId ? pill('ok', t.bokunProductId) : pill('muted', 'not linked') },
          { h: 'Roads', f: t => (t.roads || []).length ? `${t.roads.length} linked` : '–' },
          { h: '', f: t => h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => edit(t) }, 'Edit'), h('button', { class: 'btn sm danger', onclick: guard(async () => { if (!confirm(`Delete "${t.name}"?`)) return; await api('DELETE', `/tours/${encodeURIComponent(t.id)}`); toast('Deleted'); load(); }) }, 'Delete')) }], d.tours)));
    const importDlg = () => { const ta = h('textarea', { placeholder: 'id;name;type;lat;lon;departures;durationHours;capacity;priceISK;bokunProductId;roads' }); const out = h('div');
      dialog('Import tours from CSV', h('div', {}, h('p', { class: 'muted' }, 'Paste an Excel export ("CSV, semicolon delimited"). Columns: ', h('code', {}, 'id;name;type;lat;lon;departures;durationHours;capacity;priceISK;bokunProductId;region;roads'), '. Use ', h('code', {}, '09:00|13:00'), ' for several departures and ', h('code', {}, 'Hringvegur|Þórsmerkurvegur'), ' for road sections.'), ta, out),
        [{ label: 'Check', run: guard(async () => { const r = await api('POST', '/tours/import', { csv: ta.value }); out.replaceChildren(h('p', {}, `${r.preview.length} tour(s) look valid.`), ...r.errors.map(e => h('p', { class: 'muted' }, `Row ${e.row}: ${e.errors.join('; ')}`))); return false; }) },
          { label: 'Import valid rows', primary: true, run: guard(async () => { const r = await api('POST', '/tours/import?apply=1', { csv: ta.value }); toast(`Imported ${r.count ?? ''} tours`); load(); }) }]); };
    const edit = guard(async t => {
      const isNew = !t, v = t || { departures: ['09:00'], durationHours: 3, capacity: 20, type: 'hike', region: 'rvk' };
      let roads = [...(v.roads || [])], sections = [];
      const f = { id: inp(v.id, { type: 'number', disabled: !isNew }), name: inp(v.name), type: sel(TYPES, v.type), region: sel(REGIONS, v.region), lat: inp(v.lat, { type: 'number', step: 'any' }), lon: inp(v.lon, { type: 'number', step: 'any' }),
        dep: inp((v.departures || []).join(', ')), dur: inp(v.durationHours, { type: 'number', step: '0.5' }), cap: inp(v.capacity, { type: 'number' }), price: inp(v.priceISK, { type: 'number' }), bokun: inp(v.bokunProductId || ''),
        mlat: inp(v.marine ? v.marine.lat : '', { type: 'number', step: 'any' }), mlon: inp(v.marine ? v.marine.lon : '', { type: 'number', step: 'any' }),
        g0: inp(v.limits && v.limits.g ? v.limits.g[0] : '', { type: 'number', step: 'any' }), g1: inp(v.limits && v.limits.g ? v.limits.g[1] : '', { type: 'number', step: 'any' }) };
      const tagBox = h('div', { class: 'tags' }), q = inp('', { placeholder: 'Search road sections, e.g. Hringvegur, Þórsmerkurvegur…' }), sg = h('div');
      const drawTags = () => tagBox.replaceChildren(...roads.map(r => h('span', { class: 'tag' }, r, h('button', { type: 'button', 'aria-label': `Remove ${r}`, onclick: () => { roads = roads.filter(x => x !== r); drawTags(); } }, '×'))));
      const norm = s => String(s).toLowerCase().replace(/þ/g, 'th').replace(/ð/g, 'd').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '');
      q.addEventListener('input', () => { const n = norm(q.value); if (n.length < 2) return sg.replaceChildren(); const hits = sections.filter(s => norm(s.name).includes(n)).slice(0, 8);
        sg.replaceChildren(h('div', { class: 'sugg' }, hits.length ? hits.map(s => h('div', { onclick: () => { roads.push(s.name); roads = [...new Set(roads)]; drawTags(); q.value = ''; sg.replaceChildren(); } }, `${s.name} `, pill(s.state === 'closed' ? 'bad' : 'ok', s.state))) : h('div', { class: 'muted' }, sections.length ? 'No match. Press Enter to add your text as a pattern.' : 'Road list unavailable. Press Enter to add your text as a pattern.'))); });
      q.addEventListener('keydown', e => { if (e.key === 'Enter' && q.value.trim()) { e.preventDefault(); roads = [...new Set([...roads, q.value.trim()])]; drawTags(); q.value = ''; sg.replaceChildren(); } });
      drawTags(); api('GET', '/roads').then(r => { sections = r.sections || []; }).catch(() => {});
      const num = x => (x.value === '' ? undefined : +x.value);
      dialog(isNew ? 'Add tour' : `Edit · ${v.name}`, h('div', { class: 'form' }, field('ID', f.id, 'Unique number. Keep it stable.'), field('Name', f.name), field('Type', f.type, 'Decides which weather factors matter'), field('Region', f.region, 'Used for the map wind field'),
        field('Meeting point latitude', f.lat, 'Right-click the spot in Google Maps'), field('Meeting point longitude', f.lon), field('Departure times', f.dep, 'Local time, comma separated: 09:00, 13:00'), field('Duration (hours)', f.dur), field('Seats', f.cap), field('Price per guest (ISK)', f.price),
        field('Bókun product ID', f.bokun, 'Links live bookings to this tour'), field('Cancel limit: risk starts (m/s gust)', f.g0, 'Optional. Your own rule of thumb'), field('Cancel limit: usually cancelled (m/s gust)', f.g1, 'Optional. Learned automatically once enough decisions exist'),
        field('Offshore point latitude', f.mlat, 'Boat tours only (wave data)'), field('Offshore point longitude', f.mlon),
        field('Road sections that must be open', h('div', {}, tagBox, q, sg), 'If any linked section is closed, this tour is treated as very likely cancelled.', true)),
        [{ label: 'Cancel', run: () => true }, { label: 'Save tour', primary: true, run: guard(async () => {
          const tour = { ...(t || {}), id: +f.id.value, name: f.name.value.trim(), type: f.type.value, region: f.region.value, lat: num(f.lat), lon: num(f.lon), departures: f.dep.value.split(/[,;|]/).map(s => s.trim()).filter(Boolean), durationHours: num(f.dur), capacity: num(f.cap), priceISK: num(f.price), bokunProductId: f.bokun.value.trim() || null, roads };
          if (f.mlat.value && f.mlon.value) tour.marine = { lat: +f.mlat.value, lon: +f.mlon.value }; else delete tour.marine;
          if (f.g0.value && f.g1.value) tour.limits = { ...(tour.limits || {}), g: [+f.g0.value, +f.g1.value] }; else if (tour.limits) { delete tour.limits.g; if (!Object.keys(tour.limits).length) delete tour.limits; }
          await api('POST', '/tours', tour); toast('Tour saved'); load(); }) }]);
    });
    await load(); return wrap;
  }

  // ---------------------------------------------------------------- Guests
  async function guests() {
    const wrap = h('div', { style: 'display:grid;gap:18px' });
    const tourList = (await api('GET', '/tours')).tours; const names = Object.fromEntries(tourList.map(t => [t.id, t.name]));
    const load = async () => draw(await api('GET', '/guests'));
    const draw = list => wrap.replaceChildren(
      h('div', { class: 'banner' }, h('div', {}, h('b', {}, 'Personal data'), h('p', {}, 'Guest names and contact details are used only to warn them about their own booking. They are deleted automatically after the retention period (see Settings) and can be erased per booking here.'))),
      panel('Guests on file', `${list.length} booking(s)`, [h('button', { class: 'btn', onclick: importDlg }, 'Import CSV'), h('button', { class: 'btn primary', onclick: addDlg }, 'Add guest')],
        table([{ h: 'Booking', f: g => h('span', { class: 'mono' }, g.ref) }, { h: 'Guest', f: g => g.name || '–' }, { h: 'Tour', f: g => names[g.tourId] || g.tourId }, { h: 'Departure', f: g => dt(g.departure) }, { h: 'Pax', num: 1, f: g => g.pax },
          { h: 'Contact', f: g => h('div', { class: 'small' }, g.email, g.email && g.phone ? h('br') : null, g.phone) }, { h: 'Lang', f: g => g.lang }, { h: 'Paid', num: 1, f: g => isk(g.paidISK) },
          { h: '', f: g => h('button', { class: 'btn sm danger', title: 'Right to erasure: removes the guest, messages and vouchers for this booking', onclick: guard(async () => { if (!confirm(`Erase all data for booking ${g.ref}?`)) return; const r = await api('DELETE', `/guests/${encodeURIComponent(g.ref)}`); toast(`Erased ${r.guests} guest record(s)`); load(); }) }, 'Erase') }], list, 'No guests yet. Import a CSV or push them through the API.')));
    const importDlg = () => { const ta = h('textarea', { placeholder: 'ref;tourId;departure;pax;name;email;phone;lang;paidISK' }); const out = h('div');
      dialog('Import guests from CSV', h('div', {}, h('p', { class: 'muted' }, 'Columns: ', h('code', {}, 'ref;tourId;departure;pax;name;email;phone;lang;paidISK'), '. Departure like ', h('code', {}, '2026-10-20 09:00'), ' or ', h('code', {}, '20.10.2026 09:00'), '. Language: en, de or is. Phone with country code (+354…); 7-digit Icelandic numbers are accepted.'), ta, out),
        [{ label: 'Check', run: guard(async () => { const r = await api('POST', '/guests/import', { csv: ta.value }); out.replaceChildren(h('p', {}, `${r.preview} row(s) look valid.`), ...r.errors.map(e => h('p', { class: 'muted' }, `Row ${e.row}: ${e.error}`))); return false; }) }, { label: 'Import', primary: true, run: guard(async () => { const r = await api('POST', '/guests/import?apply=1', { csv: ta.value }); toast(`Imported ${r.accepted} guest(s)`); load(); }) }]); };
    const addDlg = () => { const f = { ref: inp(''), tour: sel(Object.fromEntries(tourList.map(t => [t.id, t.name])), tourList[0] && tourList[0].id), dep: inp('', { type: 'datetime-local' }), pax: inp(2, { type: 'number', min: 1 }), name: inp(''), email: inp('', { type: 'email' }), phone: inp(''), lang: sel({ en: 'English', de: 'Deutsch', is: 'Íslenska' }, 'en'), paid: inp('', { type: 'number' }) };
      dialog('Add guest', h('div', { class: 'form' }, field('Booking reference', f.ref), field('Tour', f.tour), field('Departure (UTC)', f.dep), field('Guests (pax)', f.pax), field('Name', f.name), field('Email', f.email), field('Phone', f.phone, 'With country code'), field('Language', f.lang), field('Amount paid (ISK)', f.paid, 'Used for the refund / voucher amount')),
        [{ label: 'Cancel', run: () => true }, { label: 'Save', primary: true, run: guard(async () => { await api('POST', '/guests', { ref: f.ref.value, tourId: +f.tour.value, departure: f.dep.value ? new Date(f.dep.value + 'Z').toISOString() : '', pax: +f.pax.value, name: f.name.value, email: f.email.value, phone: f.phone.value, lang: f.lang.value, paidISK: f.paid.value ? +f.paid.value : null }); toast('Guest saved'); load(); }) }]); };
    await load(); return wrap;
  }

  // ---------------------------------------------------------------- Connections
  async function connections() {
    const wrap = h('div', { style: 'display:grid;gap:18px' });
    const load = async force => draw(await api('GET', `/connectors${force ? '?force=1' : ''}`));
    const draw = list => {
      const group = (title, kinds) => { const rows = list.filter(c => c.kinds.some(k => kinds.includes(k)) && (kinds.includes('sms') || !c.kinds.some(k => ['sms', 'email'].includes(k)))); return panel(title, null, null, table([
        { h: 'Source', f: c => h('div', {}, h('b', {}, c.label), h('div', { class: 'small muted' }, c.kinds.join(', '))) }, { h: 'Status', f: c => c.enabled ? pill(c.status === 'ok' ? 'ok' : c.status === 'unconfigured' ? 'unconfigured' : 'error', c.status === 'unconfigured' ? 'not set up' : c.status) : pill('muted', 'switched off') },
        { h: 'Detail', f: c => h('span', { class: 'small' }, c.detail || '') }, { h: 'Latency', num: 1, f: c => (c.ms != null && c.status === 'ok' ? `${c.ms} ms` : '') }, { h: 'Licence', f: c => h('span', { class: 'small muted' }, c.license || '') },
        { h: 'On', f: c => sw(c.enabled, guard(async on => { await api('PUT', `/connectors/${c.id}`, { enabled: on }); toast(`${c.label} ${on ? 'enabled' : 'switched off'}`); load(); })) }], rows)); };
      wrap.replaceChildren(
        h('div', { class: 'banner' }, h('div', {}, h('b', {}, 'Keys and passwords live in the server\'s .env file'), h('p', {}, 'This page shows whether each source works and lets you switch it on or off. Secrets are never shown or stored here. After changing .env, restart the server and press Re-check.'))),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: guard(async () => { toast('Checking…'); await load(true); }) }, 'Re-check all')),
        group('Weather forecasts', ['forecast', 'marine', 'history', 'aurora']), group('Roads and stations', ['road', 'observation']), group('Bookings', ['bookings']), group('Guest messaging providers', ['sms', 'email']));
    };
    await load(); return wrap;
  }

  // ---------------------------------------------------------------- Model
  async function model() {
    const wrap = h('div', { style: 'display:grid;gap:18px' });
    const tourList = (await api('GET', '/tours')).tours;
    const load = async () => draw(await api('GET', '/model'));
    const draw = d => { const m = d.model, rep = d.report;
      wrap.replaceChildren(
        h('div', { class: 'grid' }, [['Decisions recorded', d.decisions, 'by duty managers'], ['Last trained', m.trainedAt ? dt(m.trainedAt) : 'never', `${m.samples ?? 0} usable samples`], ['Agrees with duty managers', pct(rep.agreement), `${rep.n} live decisions scored`], ['Missed cancellations', rep.missedCancellations ?? 0, 'model said go, they cancelled']].map(([l, v, n]) => h('div', { class: 'stat' }, h('div', { class: 'l' }, l), h('div', { class: 'v', style: String(v).length > 8 ? 'font-size:18px;margin-top:8px' : '' }, v), h('div', { class: 'n' }, n)))),
        panel('Cancellation limits per tour', 'learned from recorded decisions; defaults stay until enough data exists', h('button', { class: 'btn primary', onclick: guard(async () => { toast('Training…'); await api('POST', '/model/train', {}); toast('Training finished'); load(); }) }, 'Train now'),
          table([{ h: 'Tour', f: t => t.name }, { h: 'Status', f: t => { const x = m.tours && m.tours[t.id]; return x ? pill(x.status === 'learned' ? 'ok' : 'warn', x.status) : pill('muted', 'no decisions'); } },
            { h: 'Decisions', num: 1, f: t => { const x = m.tours && m.tours[t.id]; return x ? `${x.n} (${x.cancelled} cancelled)` : '0'; } }, { h: 'Learned gust limits', f: t => { const x = m.tours && m.tours[t.id]; return x && x.g ? `${x.g[0]} – ${x.g[1]} m/s (50% at ${x.p50})` : (t.limits && t.limits.g ? `manual ${t.limits.g[0]} – ${t.limits.g[1]} m/s` : 'type default'); } },
            { h: 'Why not yet', f: t => { const x = m.tours && m.tours[t.id]; return x && x.reason ? h('span', { class: 'small muted' }, x.reason) : ''; } }], tourList)),
        panel('Calibration', 'when the model says X%, how often did they actually cancel?', null, table([{ h: 'Model said', f: b => `${pct(b.from)} – ${pct(b.to)}` }, { h: 'Decisions', num: 1, f: b => b.n }, { h: 'Actually cancelled', num: 1, f: b => pct(b.observed) }], rep.calibration, 'No data.')));
    };
    await load(); return wrap;
  }

  // ---------------------------------------------------------------- Settings
  async function settings() {
    const [s, p] = await Promise.all([api('GET', '/settings'), api('GET', '/policy')]);
    const b = { name: inp(s.brand.name), color: inp(s.brand.color, { type: 'color' }), logo: inp(s.brand.logoUrl, { placeholder: 'https://…/logo.png' }), phone: inp(s.brand.phone, { placeholder: '+354 555 1234' }), email: inp(s.brand.email, { type: 'email' }), website: inp(s.brand.website), lang: sel({ en: 'English', de: 'Deutsch', is: 'Íslenska' }, s.defaultLang) };
    const offer = { ...p.offer }, auto = { ...p.autoApprove };
    const n = { bonus: inp(p.creditBonusPct, { type: 'number', min: 0, max: 100 }), months: inp(p.creditValidMonths, { type: 'number', min: 0 }), window: inp(p.rebookWindowDays, { type: 'number', min: 1 }), link: inp(p.linkValidDays, { type: 'number', min: 1 }), keep: inp(p.retentionDays, { type: 'number', min: 1 }), resp: inp(p.responseHours, { type: 'number', min: 0 }), ch: sel({ both: 'SMS and email', sms: 'SMS only', email: 'Email only' }, p.channels) };
    const OPTS = { rebook: 'Pick a new day', switch: 'Try a different adventure', credit: 'Take a voucher', refund: 'Get a refund', keep: 'Keep my booking' };
    const test = { ch: sel({ email: 'Email', sms: 'SMS' }, 'email'), to: inp('', { placeholder: 'your@email or +354…' }), lang: sel({ en: 'English', de: 'Deutsch', is: 'Íslenska' }, 'en') };
    return [
      panel('Brand', 'shown on the guest page and in messages', h('button', { class: 'btn primary', onclick: guard(async () => { await api('PUT', '/settings', { defaultLang: b.lang.value, brand: { name: b.name.value, color: b.color.value, logoUrl: b.logo.value, phone: b.phone.value, email: b.email.value, website: b.website.value } }); toast('Brand saved'); }) }, 'Save brand'),
        h('div', { class: 'pb' }, h('div', { class: 'form' }, field('Company name', b.name), field('Accent colour', b.color), field('Logo URL', b.logo, 'Optional, replaces the name in the header'), field('Phone for guests', b.phone), field('Email for guests', b.email, 'Also the reply-to address'), field('Website', b.website), field('Default guest language', b.lang)))),
      panel('What guests are offered', 'check wording against your terms and local consumer rules before enabling refunds', h('button', { class: 'btn primary', onclick: guard(async () => { await api('PUT', '/policy', { offer, autoApprove: auto, creditBonusPct: n.bonus.value, creditValidMonths: n.months.value, rebookWindowDays: n.window.value, linkValidDays: n.link.value, retentionDays: n.keep.value, responseHours: n.resp.value, channels: n.ch.value }); toast('Policy saved'); }) }, 'Save policy'),
        h('div', { class: 'pb', style: 'display:grid;gap:18px' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Option'), h('th', {}, 'Offer to guests'), h('th', {}, 'Approve automatically'))), h('tbody', {}, Object.entries(OPTS).map(([k, l]) => h('tr', {}, h('td', {}, h('b', {}, l)), h('td', {}, sw(offer[k], v => { offer[k] = v; })), h('td', {}, sw(auto[k], v => { auto[k] = v; })))))),
          h('p', { class: 'muted small' }, 'Leave automatic approval OFF until moving bookings, issuing vouchers and refunding are automated: with it off, a person approves each request and the guest is told "we will confirm shortly".'),
          h('div', { class: 'form' }, field('Voucher bonus (%)', n.bonus, 'Extra value to encourage a voucher over a refund'), field('Voucher valid (months)', n.months), field('Rebooking window (days)', n.window, 'How far ahead alternative dates are offered'), field('Link valid after departure (days)', n.link), field('Delete guest data after (days)', n.keep, 'Automatic retention'), field('We confirm within (hours)', n.resp), field('Send messages by', n.ch)))),
      panel('Send a test message', 'uses your real providers when MESSAGING_MODE=live; otherwise goes to the outbox only', null, h('div', { class: 'pb' }, h('div', { class: 'form' }, field('Channel', test.ch), field('To', test.to), field('Language', test.lang)), h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn primary', onclick: guard(async () => { const r = await api('POST', '/messages/test', { channel: test.ch.value, to: test.to.value, lang: test.lang.value }); toast(r.results.map(x => `${x.channel}: ${x.status}${x.error ? ' (' + x.error + ')' : ''}`).join(' · '), r.results.some(x => x.status === 'failed')); }) }, 'Send test')))),
    ];
  }

  // ---------------------------------------------------------------- Partners
  async function partners() {
    const wrap = h('div', { style: 'display:grid;gap:18px' });
    const base = location.origin;
    const load = async () => draw(await api('GET', '/keys'));
    const create = () => { const name = inp('', { placeholder: 'e.g. Booking tool, Zapier, Partner company' }); const scopes = { ingest: true, tours: false };
      dialog('Create API key', h('div', { class: 'form' }, field('Name', name, 'Who or what will use this key', true), h('div', { class: 'full' }, h('label', { class: 'check' }, sw(true, v => { scopes.ingest = v; }), 'Send bookings, guests and outcomes (ingest)'), h('br'), h('label', { class: 'check' }, sw(false, v => { scopes.tours = v; }), 'Create and update tours'))),
        [{ label: 'Cancel', run: () => true }, { label: 'Create key', primary: true, run: guard(async () => { const r = await api('POST', '/keys', { name: name.value, scopes: Object.keys(scopes).filter(k => scopes[k]) });
          dialog('Copy your key now', h('div', {}, h('p', { class: 'muted' }, 'This is the only time the full key is shown. Store it somewhere safe.'), h('pre', { class: 'code' }, r.key), h('button', { class: 'btn', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(r.key); toast('Copied'); } }, 'Copy')));
          load(); return false; }) }]); };
    const draw = keys => wrap.replaceChildren(
      panel('API keys', 'let other programs send you data', h('button', { class: 'btn primary', onclick: create }, 'Create key'), table([{ h: 'Name', f: k => h('b', {}, k.name) }, { h: 'Key', f: k => h('span', { class: 'mono' }, `${k.prefix}…`) }, { h: 'Can', f: k => k.scopes.map(s => ({ ingest: 'send data', tours: 'edit tours' }[s])).join(', ') }, { h: 'Created', f: k => dt(k.createdAt) }, { h: 'Last used', f: k => dt(k.lastUsedAt) }, { h: 'Status', f: k => k.revoked ? pill('bad', 'revoked') : pill('ok', 'active') },
        { h: '', f: k => k.revoked ? '' : h('button', { class: 'btn sm danger', onclick: guard(async () => { if (!confirm(`Revoke "${k.name}"? Programs using it will stop working.`)) return; await api('DELETE', `/keys/${k.id}`); toast('Revoked'); load(); }) }, 'Revoke') }], keys, 'No keys yet.')),
      panel('How other programs send data', 'each key goes in the x-api-key header', null, h('div', { class: 'pb' },
        h('p', {}, h('b', {}, 'Guests'), ' (so they can be warned):'), h('pre', { class: 'code' }, `curl -X POST ${base}/api/ingest/guests -H 'x-api-key: vv_…' -H 'content-type: application/json' \\\n  -d '{"ref":"AB-123","tourId":2,"departure":"2026-10-20T09:00:00Z","pax":4,"name":"Anna Schmidt","email":"anna@example.com","phone":"+4915112345678","lang":"de","paidISK":67600}'`),
        h('p', {}, h('b', {}, 'Bookings'), ' (seats taken per departure):'), h('pre', { class: 'code' }, `curl -X POST ${base}/api/ingest/bookings -H 'x-api-key: vv_…' -H 'content-type: application/json' \\\n  -d '{"tourId":2,"departure":"2026-10-20T09:00:00Z","pax":48,"capacity":64}'`),
        h('p', {}, h('b', {}, 'Tours'), ' (needs the "edit tours" permission):'), h('pre', { class: 'code' }, `curl -X PUT ${base}/api/partner/tours -H 'x-api-key: vv_…' -H 'content-type: application/json' \\\n  -d '{"id":7,"name":"Glacier hike","type":"hike","lat":63.53,"lon":-19.35,"departures":["09:00","13:00"],"durationHours":3,"capacity":40,"priceISK":16900}'`),
        h('p', {}, h('b', {}, 'Past outcomes'), ' (teaches the model): ', h('code', {}, 'POST /api/ingest/outcomes'), ' with ', h('code', {}, '{"tourId":2,"departure":"…","outcome":"ran|cancelled|changed"}'), '. Full reference: docs/PARTNER-API.md.'))));
    await load(); return wrap;
  }

  // ---------------------------------------------------------------- Activity
  async function activity() {
    let tab = 'outbox'; const wrap = h('div');
    const draw = async () => { const body = tab === 'outbox' ? await api('GET', '/outbox') : await api('GET', '/audit');
      wrap.replaceChildren(panel('Activity', null, tabs([['outbox', 'Messages'], ['audit', 'Audit log']], tab, k => { tab = k; draw(); }), tab === 'outbox'
        ? table([{ h: 'When', f: m => dt(m.at) }, { h: 'To', f: m => h('span', { class: 'small' }, m.to) }, { h: 'Channel', f: m => m.channel }, { h: 'Kind', f: m => m.kind }, { h: 'Status', f: m => pill(m.status === 'dry-run' ? 'dry' : m.status, m.status, m.error || m.note) }, { h: 'Message', f: m => h('button', { class: 'btn sm', onclick: () => dialog(`${m.channel} to ${m.to}`, h('div', {}, m.subject ? h('p', {}, h('b', {}, m.subject)) : null, h('div', { class: 'msgbox' }, m.text), m.error ? h('p', { class: 'muted' }, `Error: ${m.error}`) : null)) }, 'View') }], body, 'No messages yet.')
        : table([{ h: 'When', f: a => dt(a.at) }, { h: 'Who', f: a => a.who }, { h: 'Action', f: a => h('span', { class: 'mono' }, a.action) }, { h: 'Details', f: a => h('span', { class: 'small muted' }, JSON.stringify(a.details)) }], body, 'Nothing logged yet.'))); };
    await draw(); return wrap;
  }


  // ---------------------------------------------------------------- Cameras
  async function cameras() {
    const wrap = h('div', { style: 'display:grid;gap:18px' });
    const tourList = (await api('GET', '/tours')).tours, tname = Object.fromEntries(tourList.map(t => [t.id, t.name]));
    const load = async () => draw(await api('GET', '/cameras'));
    const SRC = { own: 'Our own camera', vegagerdin: 'Vegagerðin', imo: 'Icelandic Met Office', partner: 'Partner', other: 'Other' };
    const test = guard(async c => { const r = await api('POST', `/cameras/${c.id}/test`, {}); toast(r.ok ? (r.note || `Works: ${Math.round(r.bytes / 1024)} KB ${r.type} in ${r.ms} ms`) : `Failed: ${r.error}`, !r.ok); });
    const draw = list => wrap.replaceChildren(
      h('div', { class: 'banner' }, h('div', {}, h('b', {}, 'Two kinds of camera'), h('p', {}, 'Page: a link to a public camera page (Vegagerðin road cameras, Met Office). It opens in a new tab and is never copied, so the owner\'s terms are respected. Image: a snapshot your server fetches from YOUR OWN camera (Frigate, go2rtc, MediaMTX, MotionEye…) and shows on the dashboard. See docs/CAMERAS.md.'))),
      h('div', { class: 'banner warn' }, h('div', {}, h('b', {}, 'Cameras film people'), h('p', {}, 'Cameras that cover guests, staff or the public need clear signs and a lawful purpose (Persónuvernd rules). Point cameras at car parks, trails and weather, not at people where you can avoid it. Never embed someone else\'s image feed without their permission.'))),
      panel('Cameras', `${list.length} configured`, h('button', { class: 'btn primary', onclick: () => edit(null) }, 'Add camera'),
        table([{ h: 'Camera', f: c => h('div', {}, h('b', {}, c.name), h('div', { class: 'small muted' }, `${c.id} · ${c.type === 'page' ? 'link-out page' : `image, every ${c.refreshSec || 60}s`}`)) }, { h: 'Source', f: c => SRC[c.source] || c.source },
          { h: 'Shown for', f: c => c.global ? pill('ok', 'everyone (footer)') : (c.tours || []).length ? (c.tours || []).map(id => tname[id] || id).join(', ') : h('span', { class: 'muted' }, 'no tour yet') },
          { h: 'Address', f: c => h('span', { class: 'small mono' }, c.url) }, { h: 'Login', f: c => c.authEnv ? pill(c.authSet ? 'ok' : 'warn', c.authSet ? 'set in .env' : `${c.authEnv} missing`) : '–' },
          { h: 'On', f: c => sw(c.enabled !== false, guard(async on => { await api('POST', '/cameras', { ...c, enabled: on }); load(); })) },
          { h: '', f: c => h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => test(c) }, 'Test'), h('button', { class: 'btn sm', onclick: () => edit(c) }, 'Edit'), h('button', { class: 'btn sm danger', onclick: guard(async () => { if (!confirm(`Remove "${c.name}"?`)) return; await api('DELETE', `/cameras/${encodeURIComponent(c.id)}`); toast('Removed'); load(); }) }, 'Remove')) }], list, 'No cameras yet.')));
    const edit = guard(async c => {
      const isNew = !c, v = c || { type: 'image', source: 'own', own: true, refreshSec: 60, tours: [], enabled: true };
      const f = { id: inp(v.id, { disabled: !isNew, placeholder: 'glacier-car-park' }), name: inp(v.name, { placeholder: 'Glacier car park' }), type: sel({ image: 'Image snapshot (our own camera)', page: 'Link to a public page' }, v.type), source: sel(SRC, v.source), url: inp(v.url, { placeholder: 'https://…' }),
        refresh: inp(v.refreshSec || 60, { type: 'number', min: 15, max: 3600 }), auth: inp(v.authEnv || '', { placeholder: 'CAM_GLACIER_AUTH' }), attr: inp(v.attribution || ''), perm: inp(v.permission || '', { placeholder: 'Licence or written permission that allows showing this image' }) };
      const own = h('input', { type: 'checkbox', checked: v.own !== false && v.type === 'image' }), glob = h('input', { type: 'checkbox', checked: !!v.global });
      const picked = new Set((v.tours || []).map(Number));
      const tourBoxes = h('div', { class: 'tags' }, tourList.map(t => h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: picked.has(t.id), onchange: e => (e.target.checked ? picked.add(t.id) : picked.delete(t.id)) }), t.name)));
      const prev = h('div');
      dialog(isNew ? 'Add camera' : `Edit · ${v.name}`, h('div', {}, h('div', { class: 'form' }, field('ID', f.id, 'Short name, lowercase'), field('Name', f.name), field('Type', f.type), field('Source', f.source), field('Address (URL)', f.url, 'Image: the snapshot (JPEG) address. Page: the web page', true),
        field('Refresh (seconds)', f.refresh, 'Image cameras only, 15–3600'), field('Login variable', f.auth, 'Name of a variable in .env holding the full Authorization header value, e.g. Basic dXNlcjpwdw==. Never paste passwords here'),
        field('Credit shown', f.attr), field('Permission (third-party images only)', f.perm, 'Required if this is not our own camera', true),
        h('label', { class: 'check full' }, own, 'This is our own camera'), h('label', { class: 'check full' }, glob, 'Show as a link for everyone (dashboard footer), not for specific tours'),
        h('div', { class: 'full' }, h('b', {}, 'Show on these tours'), tourBoxes)), prev),
        [{ label: 'Cancel', run: () => true }, { label: 'Save and test', primary: true, run: guard(async () => {
          const cam = { ...(c || {}), id: f.id.value.trim(), name: f.name.value.trim(), type: f.type.value, source: f.source.value, url: f.url.value.trim(), attribution: f.attr.value, own: own.checked, global: glob.checked, tours: [...picked], enabled: true };
          if (cam.type === 'image') { cam.refreshSec = +f.refresh.value || 60; cam.permission = f.perm.value; } else { delete cam.refreshSec; delete cam.permission; }
          if (f.auth.value.trim()) cam.authEnv = f.auth.value.trim(); else delete cam.authEnv;
          await api('POST', '/cameras', cam); toast('Camera saved'); load();
          if (cam.type === 'image') { const r = await api('POST', `/cameras/${cam.id}/test`, {}); toast(r.ok ? `Test OK (${Math.round(r.bytes / 1024)} KB)` : `Saved, but the test failed: ${r.error}`, !r.ok); }
        }) }]);
    });
    await load(); return wrap;
  }

  // ---------------------------------------------------------------- Router
  const ROUTES = [['overview', 'Overview', overview, '◎'], ['notifications', 'Notifications', notifications, '✉'], ['requests', 'Guest requests', requests, '☑'], ['tours', 'Tours', tours, '⛰'], ['cameras', 'Cameras', cameras, '◉'], ['guests', 'Guests', guests, '☺'], ['connections', 'Connections', connections, '⇄'], ['model', 'Model', model, '∿'], ['settings', 'Settings', settings, '⚙'], ['partners', 'Partners & API', partners, '⌘'], ['activity', 'Activity', activity, '≡']];
  $('#nav').replaceChildren(...ROUTES.map(([id, label, , ico]) => h('a', { href: `#${id}`, 'data-id': id }, h('span', { 'aria-hidden': 'true' }, ico), label)));
  async function render() {
    const id = location.hash.slice(1) || 'overview', r = ROUTES.find(x => x[0] === id) || ROUTES[0];
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.id === r[0]));
    $('#title').textContent = r[1]; $('#side').classList.remove('open');
    const v = $('#view'); v.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    try { const out = await r[2](); v.replaceChildren(...[].concat(out)); } catch (e) { v.replaceChildren(h('div', { class: 'banner bad' }, h('div', {}, h('b', {}, 'Could not load this section'), h('p', {}, e.message)))); }
    if (!overviewCache) api('GET', '/overview').then(o => { overviewCache = o; badge(o); }).catch(() => {});
  }
  $('#menu').addEventListener('click', () => $('#side').classList.toggle('open'));
  window.addEventListener('hashchange', render); render();
})();
