// Guest page. Text comes from the server in the guest's language (v.strings); this file only lays it out.
// Everything is built with DOM nodes and textContent, so nothing a guest or operator typed can inject markup.
(() => {
  const token = location.pathname.split('/').filter(Boolean).pop();
  const app = document.getElementById('app');
  const LOCALE = { en: 'en-GB', de: 'de-DE', is: 'is-IS' };
  let v = null, view = 'choose', option = null, pick = null, busy = false, error = '';

  const ICON = {
    wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    ticket: '<path d="M4 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v1.5h16V16a2 2 0 0 1 0-4v0a2 2 0 0 0 0-4V6.5H4Z"/><path d="M14 7v10" stroke-dasharray="2 2.5"/>',
    refund: '<path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4h4"/><path d="M12 8.5v7M9.8 10.2c.5-.7 1.3-1 2.2-1 1.2 0 2.2.5 2.2 1.4 0 2-4.4 1-4.4 3 0 .9 1 1.4 2.2 1.4.9 0 1.7-.3 2.2-1"/>',
    pause: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    chev: '<path d="m9 5 7 7-7 7"/>', back: '<path d="m15 5-7 7 7 7"/>', users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14c2 .6 3.5 2.3 3.5 5"/>',
    pin: '<path d="M12 21s6.5-5.7 6.5-11A6.5 6.5 0 0 0 5.5 10c0 5.3 6.5 11 6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  };
  const svg = (name, cls = '') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls); s.innerHTML = ICON[name]; return s; };
  const h = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const [k, val] of Object.entries(attrs || {})) { if (k === 'class') e.className = val; else if (k.startsWith('on')) e.addEventListener(k.slice(2), val); else if (val !== false && val != null) e.setAttribute(k, val === true ? '' : val); } for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
  const T = (k, vars = {}) => (v.strings[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => (vars[n] != null ? vars[n] : `{${n}}`));
  const loc = () => LOCALE[v.lang] || 'en-GB';
  const money = n => `${new Intl.NumberFormat(loc(), { maximumFractionDigits: 0 }).format(Math.round(n))} kr.`;
  const dayFmt = iso => new Intl.DateTimeFormat(loc(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(iso));
  const shortDay = iso => new Intl.DateTimeFormat(loc(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(iso));
  const time = iso => new Date(iso).toISOString().slice(11, 16);
  const whenFull = iso => `${dayFmt(iso)} ${T('at')} ${time(iso)}`;

  async function load(lang) {
    const q = lang ? `?lang=${lang}` : '';
    const r = await fetch(`/api/guest/${encodeURIComponent(token)}${q}`);
    if (r.status === 404) { v = null; return; }
    if (!r.ok) throw new Error(String(r.status));
    v = await r.json();
  }

  function chrome() {
    document.documentElement.lang = v.lang;
    document.documentElement.style.setProperty('--brand', v.brand.color || '#0b5c70');
    document.title = `${v.brand.name} · ${v.tour.name}`;
    const b = document.getElementById('brand'); b.replaceChildren(v.brand.logoUrl ? h('img', { src: v.brand.logoUrl, alt: v.brand.name }) : v.brand.name);
    const sel = document.getElementById('lang'); sel.replaceChildren(...Object.entries(v.langs).map(([k, n]) => h('option', { value: k, selected: k === v.lang }, n)));
    document.getElementById('langLabel').textContent = T('lang_label');
    const f = document.getElementById('foot'); f.replaceChildren();
  }

  function help() {
    const c = v.contact, bits = [];
    if (c.phone) bits.push(h('a', { href: `tel:${c.phone.replace(/\s/g, '')}` }, c.phone));
    if (c.email) bits.push(h('a', { href: `mailto:${c.email}` }, c.email));
    return h('p', { class: 'help' }, T('help'), bits.length ? ' ' : '', ...bits.flatMap((b, i) => (i ? [' · ', b] : [b])));
  }

  function gauge() {
    const r = v.reason;
    if (r.code !== 'wind' || !r.limit) return null;
    const max = Math.max(r.gust, r.limit) * 1.25, pos = x => `${Math.min(97, (x / max) * 100)}%`;
    const g = h('div', { class: 'gauge', role: 'img', 'aria-label': r.text }, h('i', { class: 'limit', style: `left:${pos(r.limit)}` }, h('b', {}, `${Math.round(r.limit)} m/s`)), h('i', { style: `left:${pos(r.gust)}` }, h('b', {}, `${Math.round(r.gust)} m/s`)));
    return g;
  }

  const OPT_ICON = { rebook: 'cal', switch: 'swap', credit: 'ticket', refund: 'refund', keep: 'pause' };

  function summaryCard() {
    const warn = v.kind === 'warning';
    return h('section', { class: 'card' },
      h('p', { class: 'hello' }, v.guest.firstName ? T('hello', { name: v.guest.firstName }) : ''),
      h('div', { class: 'status' },
        h('div', { class: `badge ${v.kind}` }, svg('wind')),
        h('div', {}, h('h1', { tabindex: '-1', id: 'h1' }, T(warn ? 'banner_warning' : 'banner_cancelled', { tour: v.tour.name })),
          h('p', { class: 'meta' }, h('span', {}, svg('cal'), v.fmt.whenText), h('span', {}, svg('users'), v.fmt.guestsText), h('span', {}, `${T('ref_label')} ${v.guest.ref}`)))),
      h('div', { class: 'why' }, h('p', {}, v.reason.text), gauge(), h('p', { class: 'note' }, warn ? T('deadline_warning', { time: time(v.deadlineIso) }) : T('deadline_cancelled'))));
  }

  function chooseView() {
    const o = v.options, cards = [];
    const add = (type, title, desc, rec) => cards.push(h('button', { class: `opt${rec ? ' rec' : ''}`, onclick: () => go(type === 'rebook' || type === 'switch' ? 'pick' : 'confirm', type) }, h('span', { class: 'ic' }, svg(OPT_ICON[type])), h('span', { class: 'tx' }, h('b', {}, title), h('span', {}, desc)), svg('chev', 'chev')));
    if (o.rebook.length || v.kind) if (o.rebook.length) add('rebook', T('opt_rebook_title'), T('opt_rebook_desc'), true);
    if (o.switch.length) add('switch', T('opt_switch_title'), T('opt_switch_desc'));
    if (o.credit) add('credit', T('opt_credit_title'), o.credit.bonusPct ? T('opt_credit_desc', { value: money(o.credit.valueISK), bonus: o.credit.bonusPct, months: o.credit.months }) : T('opt_credit_desc_nobonus', { value: money(o.credit.valueISK), months: o.credit.months }));
    if (o.refund) add('refund', T('opt_refund_title'), T('opt_refund_desc', { amount: money(o.refund.amountISK) }));
    if (o.keep) add('keep', T('opt_keep_title'), T('opt_keep_desc', { time: time(v.deadlineIso) }));
    return [summaryCard(), h('section', { class: 'card' }, h('h2', {}, T('choose_title')), h('div', { class: 'opts' }, cards),
      !o.rebook.length ? h('p', { class: 'empty' }, T('no_alternatives', { days: o.windowDays })) : null), help()];
  }

  function badge(a) { const k = a.outlook === 'good' ? ['good', 'badge_best'] : a.outlook === 'ok' ? ['ok', 'badge_ok'] : ['unknown', 'badge_unknown']; return h('span', { class: `tag ${k[0]}` }, T(k[1])); }
  function seats(a) { return a.seatsLeft == null ? T('seats_unknown') : T('seats_left', { n: a.seatsLeft }); }
  function price(a) { if (!a.tourId || a.same) return null; return a.priceDiffISK === 0 ? T('price_same') : a.priceDiffISK > 0 ? T('price_pay', { amount: money(a.priceDiffISK) }) : T('price_back', { amount: money(-a.priceDiffISK) }); }

  function pickView() {
    const list = option === 'rebook' ? v.options.rebook : v.options.switch;
    const items = list.map(a => h('li', {}, h('button', { class: 'pick', 'aria-pressed': String(pick && pick.departure === a.departure && String(pick.tourId) === String(a.tourId)), onclick: () => { pick = a; render(); } },
      h('span', { class: 'when' }, h('b', {}, option === 'switch' ? a.tourName : shortDay(a.departure)), h('span', {}, option === 'switch' ? `${shortDay(a.departure)} ${T('at')} ${time(a.departure)}` : `${T('at')} ${time(a.departure)}`), h('em', {}, [seats(a), price(a)].filter(Boolean).join(' · '))), badge(a))));
    return [h('section', { class: 'card' },
      h('button', { class: 'back', onclick: () => go('choose') }, svg('back'), T('back_btn')),
      h('h2', { tabindex: '-1', id: 'h1' }, T(option === 'rebook' ? 'opt_rebook_title' : 'opt_switch_title')),
      list.length ? h('ul', { class: 'list' }, items) : h('p', { class: 'empty' }, T('no_alternatives', { days: v.options.windowDays })),
      h('div', { style: 'height:16px' }), h('button', { class: 'btn', disabled: !pick, onclick: () => go('confirm', option) }, T('next_btn')))];
  }

  function chosenText() {
    switch (option) {
      case 'rebook': return T('you_chose_rebook', { date: whenFull(pick.departure) });
      case 'switch': return T('you_chose_switch', { tour: pick.tourName, date: whenFull(pick.departure) });
      case 'credit': return T('you_chose_credit', { value: money(v.options.credit.valueISK) });
      case 'refund': return T('you_chose_refund', { amount: money(v.options.refund.amountISK) });
      default: return T('you_chose_keep');
    }
  }
  function confirmView() {
    return [h('section', { class: 'card' },
      h('button', { class: 'back', onclick: () => go(option === 'rebook' || option === 'switch' ? 'pick' : 'choose') }, svg('back'), T('back_btn')),
      h('h2', { tabindex: '-1', id: 'h1' }, T('confirm_title')), error ? h('p', { class: 'err', role: 'alert' }, error) : null,
      h('p', { class: 'sum' }, chosenText()), h('button', { class: 'btn', disabled: busy, onclick: submit }, T('confirm_btn')))];
  }

  function doneView() {
    const c = v.choice, st = c.status;
    return [h('section', { class: 'card done' },
      h('div', { class: `badge ${st === 'rejected' ? 'cancelled' : 'done'}` }, svg('check', 'check')),
      h('h1', { tabindex: '-1', id: 'h1' }, T('done_title')), h('p', { class: 'note' }, c.text),
      h('span', { class: `state ${st}` }, T(`done_${st}`)),
      c.voucherCode ? h('div', { class: 'code' }, c.voucherCode, h('button', { onclick: e => { navigator.clipboard && navigator.clipboard.writeText(c.voucherCode); e.target.textContent = '✓'; } }, 'copy')) : null,
      st === 'pending' ? h('button', { class: 'btn ghost', onclick: () => { v.choice = null; reloadOptions(); } }, T('change_btn')) : null,
      st === 'approved' || st === 'done' ? h('p', { class: 'note', style: 'margin-top:14px' }, T('locked')) : null), help()];
  }

  async function reloadOptions() { await load(v.lang); view = 'choose'; option = pick = null; render(); }
  function go(next, opt) { view = next; if (opt) option = opt; error = ''; if (next !== 'confirm' && opt && opt !== option) pick = null; if (next === 'confirm' && (option === 'keep' || option === 'credit' || option === 'refund')) pick = null; render(); }

  async function submit() {
    busy = true; error = ''; render();
    try {
      const body = { type: option, ...(pick ? { departure: pick.departure, tourId: pick.tourId } : {}) };
      const r = await fetch(`/api/guest/${encodeURIComponent(token)}/choose`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { error = j.error || T('err_generic'); if (r.status === 409) { await load(v.lang); view = 'done'; } else if (/no longer available/.test(error)) { await load(v.lang); view = 'pick'; pick = null; } }
      else { v = j; view = 'done'; }
    } catch { error = T('err_generic'); }
    busy = false; render();
  }

  function render() {
    chrome();
    const nodes = v.choice && view !== 'choose' && view !== 'pick' && view !== 'confirm' ? doneView()
      : view === 'pick' ? pickView() : view === 'confirm' ? confirmView()
      : v.choice ? doneView() : chooseView();
    app.replaceChildren(...nodes);
    const f = document.getElementById('h1'); if (f) f.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }

  function fail(msg) { document.title = 'Booking'; app.replaceChildren(h('section', { class: 'card done' }, h('h1', {}, msg || 'This link is not valid or has expired.'))); }

  document.getElementById('lang').addEventListener('change', async e => { const l = e.target.value; await load(l); const u = new URL(location.href); u.searchParams.set('lang', l); history.replaceState(null, '', u); render(); });
  const wanted = new URLSearchParams(location.search).get('lang') || undefined;
  load(wanted).then(() => (v ? (view = v.choice ? 'done' : 'choose', render()) : fail())).catch(() => fail('Something went wrong. Please try again.'));
})();
