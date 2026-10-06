// Rendering functions. Each draws one section of the dashboard into the DOM.

// ---------- map
const P=([lon,lat])=>[(lon+24.75)*40,(66.72-lat)*40*2.25];
function gustCol(g){return g>=27?"var(--cancel)":g>=20?"var(--change)":"var(--faint)"}
function drawMap(){
  const svg=document.getElementById("map");const pts=COAST.map(P);
  let h=`<defs><clipPath id="isl"><path d="M${pts.map(p=>p.join(",")).join("L")}Z"/></clipPath>
   <pattern id="gr" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="var(--sea2)" stroke-width=".6"/></pattern></defs>
   <rect width="470" height="318" fill="var(--sea)"/><rect width="470" height="318" fill="url(#gr)"/>`;
  // gust heat on land
  let heat="";for(let lon=-24.6;lon<=-13.3;lon+=.35)for(let lat=63.3;lat<=66.6;lat+=.14){const I=idw(lon,lat,hour);const [x,y]=P([lon,lat]);
    const a=clamp((I.g-12)/20,0,1);if(a<.05)continue;const col=I.g>=27?"var(--cancel)":I.g>=20?"var(--change)":"var(--go)";
    heat+=`<rect x="${x-7.2}" y="${y-6.6}" width="14.4" height="13.2" fill="${col}" opacity="${(a*.32).toFixed(2)}"/>`}
  h+=`<path d="M${pts.map(p=>p.join(",")).join("L")}Z" fill="var(--land)"/>`;
  h+=`<g clip-path="url(#isl)">${heat}`;
  GLAC.forEach(g=>{const [x,y]=P(g.c);h+=`<ellipse cx="${x}" cy="${y}" rx="${g.rx}" ry="${g.ry}" fill="var(--ice)" stroke="var(--iceline)" stroke-width=".8" opacity=".9"/>`});
  h+=`</g><path d="M${pts.map(p=>p.join(",")).join("L")}Z" fill="none" stroke="var(--landline)" stroke-width="1.1" stroke-linejoin="round"/>`;
  GLAC.forEach(g=>{if(!g.n)return;const [x,y]=P(g.c);h+=`<text x="${x}" y="${y+3}" text-anchor="middle" font-family="IBM Plex Sans,sans-serif" font-size="7.5" font-style="italic" fill="var(--muted)" opacity=".8">${g.n}</text>`});
  // wind arrows grid (sea + land)
  for(let lon=-24.3;lon<=-13.6;lon+=1.05)for(let lat=63.45;lat<=66.5;lat+=.42){const I=idw(lon,lat,hour);const [x,y]=P([lon,lat]);const len=5+I.w*.75;const ang=(I.dir+180)%360;
    h+=`<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${ang.toFixed(0)})"><line y1="${len/2}" y2="${-len/2}" stroke="${gustCol(I.g)}" stroke-width="1.3"/><path d="M-2.6,${-len/2+3.6}L0,${-len/2}L2.6,${-len/2+3.6}" fill="none" stroke="${gustCol(I.g)}" stroke-width="1.3"/></g>`}
  PLACES.forEach(([n,lon,lat])=>{const [x,y]=P([lon,lat]);h+=`<circle cx="${x}" cy="${y}" r="1.8" fill="var(--ink)"/><text x="${x+4}" y="${y-3}" font-family="IBM Plex Sans,sans-serif" font-size="8" fill="var(--ink)" opacity=".75">${n}</text>`});
  // tour pins: next departure at/after hour
  TOURS.forEach(t=>{const nx=DEPS.filter(d=>d.t.id===t.id&&d.h+t.dur>=hour).sort((a,b)=>a.h-b.h)[0];if(!nx)return;const R=risk(t,nx.h);const [x,y]=P(t.ll);
    const s=selKey&&selKey.startsWith(t.id+"-");
    h+=`<g class="pin" tabindex="0" role="button" data-key="${nx.key}" aria-label="${t.name}, ${STAT[R.status]}, ${pct(R.cancel)} líkur á aflýsingu">
      ${s?`<circle cx="${x}" cy="${y}" r="13" fill="none" stroke="var(--accent)" stroke-width="2"/>`:""}
      <circle cx="${x}" cy="${y}" r="8.5" fill="${COL[R.status]}" stroke="var(--panel)" stroke-width="2"/>
      <text x="${x}" y="${y+3}" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="7.5" font-weight="600" fill="var(--panel)">${Math.round(R.cancel*100)}</text>
      ${s?`<text x="${x+15}" y="${y+3}" font-family="IBM Plex Sans,sans-serif" font-size="9" font-weight="600" fill="var(--ink)" stroke="var(--land)" stroke-width="3" paint-order="stroke">${t.name}</text>`:""}</g>`});
  // legend
  h+=`<g font-family="IBM Plex Sans,sans-serif" font-size="8" fill="var(--muted)"><g transform="translate(400,22)"><rect x="-6" y="-12" width="66" height="42" rx="4" fill="var(--panel)" opacity=".85"/><text x="0" y="-2">Hviður</text>
    <rect x="0" y="4" width="9" height="6" fill="var(--go)" opacity=".5"/><text x="12" y="10">&lt; 20 m/s</text>
    <rect x="0" y="13" width="9" height="6" fill="var(--change)" opacity=".5"/><text x="12" y="19">20–27</text>
    <rect x="0" y="22" width="9" height="6" fill="var(--cancel)" opacity=".5"/><text x="12" y="28">&gt; 27</text></g></g>`;
  svg.innerHTML=h;
  svg.querySelectorAll(".pin").forEach(g=>bindSel(g,g.dataset.key));
}
function bindSel(el,key){const f=()=>{selKey=key;const d=DEPS.find(x=>x.key===key);if(d){hour=clamp(d.h,0,71);document.getElementById("hour").value=hour}render(true)};
  el.onclick=f;el.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();f()}}}

// ---------- queue
function drawQueue(all){
  const q=all.filter(d=>d.R.status!=="go"||d.h<NOW+30).sort((a,b)=>{const ra={cancel:0,change:1,go:2};return ra[a.R.status]-ra[b.R.status]||deadline(a.h)-deadline(b.h)});
  document.getElementById("queue").innerHTML=q.map(d=>{const dl=deadline(d.h);const left=dl-NOW;
    return `<div class="qrow" role="option" tabindex="0" data-key="${d.key}" aria-selected="${d.key===selKey}">
    <span class="stripe" style="background:${COL[d.R.status]}"></span>
    <div style="min-width:0"><div class="t">${d.t.name}</div>
      <div class="m">${dayLbl(d.h)} ${hhmm(d.h)} · ${d.pax} gestir · ${fmtM(d.pax*d.t.price*d.R.cancel).replace(" m.kr."," m")} í hættu</div>
      <div style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap"><span class="pill p-${d.R.status}">${STAT[d.R.status]}</span>${d.R.status!=="go"?`<span class="pill" style="background:var(--sunk);color:var(--muted)">Ákvörðun ${left<=0?"núna":"eftir "+left+" klst."}</span>`:""}</div></div>
    <div class="r big" style="color:${COL[d.R.status]}">${pct(d.R.cancel)}<small>aflýsing ±${Math.round(d.R.unc*100)}</small></div></div>`}).join("");
  document.querySelectorAll(".qrow").forEach(r=>bindSel(r,r.dataset.key));
}

// ---------- matrix
function drawMatrix(){
  let h=`<tr><th></th>`;for(let d=0;d<3;d++)h+=`<th class="day" colspan="8">${dayLbl(d*24)}</th>`;h+=`</tr><tr><th></th>`;
  for(let b=0;b<24;b++)h+=`<th>${String((b%8)*3).padStart(2,"0")}</th>`;h+=`</tr>`;
  TOURS.forEach(t=>{h+=`<tr><td class="nm" title="${t.name}">${t.name}</td>`;
    for(let b=0;b<24;b++){const hh=b*3;const R=risk(t,hh,Math.min(t.dur,3));const dep=DEPS.find(d=>d.t.id===t.id&&d.h>=hh&&d.h<hh+3);
      const v=R.cancel;const col=v<.2?`color-mix(in srgb,var(--go) ${Math.round(20+v*120)}%,var(--panel))`:v<.5?`color-mix(in srgb,var(--change) ${Math.round(45+(v-.2)*140)}%,var(--panel))`:`color-mix(in srgb,var(--cancel) ${Math.round(55+(v-.5)*90)}%,var(--panel))`;
      const past=hh+3<=NOW;
      h+=`<td class="cell${dep?" dep":""}${dep&&dep.key===selKey?" sel":""}" style="background:${col};${past?"opacity:.35":""}" ${dep?`tabindex="0" data-key="${dep.key}"`:""} title="${t.name} · ${dayLbl(hh)} ${hhmm(hh)}–${hhmm(hh+3)} · ${pct(v)} áhætta${dep?" · brottför "+hhmm(dep.h)+", "+dep.pax+" gestir":""}"></td>`}
    h+=`</tr>`});
  const mx=document.getElementById("mx");mx.innerHTML=h;
  mx.querySelectorAll(".cell[data-key]").forEach(c=>bindSel(c,c.dataset.key));
}

// ---------- KPIs + alert
function drawTop(all){
  const next=all.filter(d=>d.h<NOW+48);
  const pax=next.reduce((s,d)=>s+d.pax,0);
  const risky=next.filter(d=>d.R.status!=="go");
  const rev=next.reduce((s,d)=>s+d.pax*d.t.price*d.R.cancel,0);
  const exp=next.reduce((s,d)=>s+d.pax*d.R.cancel,0);
  const kp=[["Brottfarir · 48 klst.",next.length,"",`${pax.toLocaleString("de-DE")} gestir bókaðir`],
   ["Þarf ákvörðun",risky.length,"c",`${next.filter(d=>d.R.status==="cancel").length} líklegar aflýsingar`],
   ["Gestir sem gætu misst ferð",Math.round(exp),"","vegið með líkum"],
   ["Tekjur í hættu",fmtM(rev),"c","væntar endurgreiðslur"],
   ["Hægt að endurheimta",fmtM(rev*.64),"g","64% endurbókun + varaferðir"]];
  document.getElementById("kpis").innerHTML=kp.map(k=>`<div class="kpi"><div class="l">${k[0]}</div><div class="v ${k[2]}">${k[1]}</div><div class="n">${k[3]}</div></div>`).join("");
  const peak=Object.keys(REG).map(r=>({r,...(()=>{let m={g:0,h:0};for(let h=NOW;h<72;h++){const g=wx(r,h).g;if(g>m.g)m={g,h}}return m})()})).sort((a,b)=>b.g-a.g)[0];
  document.getElementById("alert").innerHTML=`<div class="ic">!</div><div class="t"><b>Djúp lægð nálgast úr suðvestri.</b> Hviður allt að ${Math.round(peak.g)} m/s á ${REG[peak.r].n.toLowerCase()} ${dayLbl(peak.h)} um kl. ${hhmm(peak.h)}. ${risky.length} brottfarir með ${risky.reduce((s,d)=>s+d.pax,0)} gestum þurfa ákvörðun.</div><button class="btn primary" id="toQ">Fara yfir röð</button>`;
  document.getElementById("toQ").onclick=()=>document.getElementById("queue").scrollIntoView({behavior:"smooth",block:"center"});
}

// ---------- detail
function chartFor(d){
  const t=d.t,f=TYPES[t.type].f,main=d.R.parts[0].k;const [lo,hi]=f[main];
  const h0=Math.max(0,d.h-18),h1=Math.min(71,d.h+t.dur+18);const vals=[];for(let h=h0;h<=h1;h++)vals.push([h,wx(t.r,h)[main]]);
  const vmax=Math.max(hi*1.15,...vals.map(v=>v[1]))*1.05;const W=560,H=200,L=40,Rr=10,T=12,B=28;
  const x=h=>L+(h-h0)/(h1-h0)*(W-L-Rr),y=v=>T+(1-v/vmax)*(H-T-B);
  const unc=d.R.unc;
  let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Spá fyrir ${FL[main][0]}">`;
  s+=`<rect x="${x(d.h)}" y="${T}" width="${x(d.h+t.dur)-x(d.h)}" height="${H-T-B}" fill="var(--accent)" opacity=".09"/>`;
  s+=`<rect x="${L}" y="${y(vmax)}" width="${W-L-Rr}" height="${y(hi)-y(vmax)}" fill="var(--cancel)" opacity=".07"/>`;
  s+=`<rect x="${L}" y="${y(hi)}" width="${W-L-Rr}" height="${y(lo)-y(hi)}" fill="var(--change)" opacity=".08"/>`;
  const ticks=5;for(let i=0;i<=ticks;i++){const v=vmax/ticks*i;s+=`<line x1="${L}" x2="${W-Rr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width=".7"/><text x="${L-6}" y="${y(v)+3}" text-anchor="end" font-family="IBM Plex Mono,monospace" font-size="9" fill="var(--muted)">${v.toFixed(v<10?1:0).replace(".",",")}</text>`}
  for(let h=Math.ceil(h0/6)*6;h<=h1;h+=6)s+=`<text x="${x(h)}" y="${H-12}" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="9" fill="var(--muted)">${hhmm(h)}</text>${h%24===0?`<text x="${x(h)}" y="${H-1}" text-anchor="middle" font-family="IBM Plex Sans,sans-serif" font-size="9" fill="var(--ink)">${dayLbl(h)}</text>`:""}`;
  // uncertainty band
  const up=vals.map(([h,v])=>[x(h),y(v*(1+unc*.8*Math.max(0,(h-NOW))/40))]),dn=vals.map(([h,v])=>[x(h),y(v*(1-unc*.8*Math.max(0,(h-NOW))/40))]).reverse();
  s+=`<path d="M${up.map(p=>p.join(",")).join("L")}L${dn.map(p=>p.join(",")).join("L")}Z" fill="var(--accent)" opacity=".14"/>`;
  s+=`<polyline points="${vals.map(([h,v])=>x(h)+","+y(v)).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
  s+=`<line x1="${L}" x2="${W-Rr}" y1="${y(lo)}" y2="${y(lo)}" stroke="var(--change)" stroke-dasharray="4 3"/><text x="${W-Rr-2}" y="${y(lo)-4}" text-anchor="end" font-family="IBM Plex Sans,sans-serif" font-size="9" fill="var(--change)">Áhætta byrjar ${lo}</text>`;
  s+=`<line x1="${L}" x2="${W-Rr}" y1="${y(hi)}" y2="${y(hi)}" stroke="var(--cancel)" stroke-dasharray="4 3"/><text x="${W-Rr-2}" y="${y(hi)-4}" text-anchor="end" font-family="IBM Plex Sans,sans-serif" font-size="9" fill="var(--cancel)">Sögulegt aflýsingarmark ${hi}</text>`;
  if(NOW>=h0)s+=`<line x1="${x(NOW)}" x2="${x(NOW)}" y1="${T}" y2="${H-B}" stroke="var(--ink)" stroke-width="1"/><text x="${x(NOW)+3}" y="${T+9}" font-family="IBM Plex Sans,sans-serif" font-size="9" fill="var(--ink)">Núna</text>`;
  const pk=d.R.parts[0].v;s+=`<text x="${x(d.h)+4}" y="${H-B-6}" font-family="IBM Plex Sans,sans-serif" font-size="9" fill="var(--accent)">Ferð ${hhmm(d.h)}–${hhmm(d.h+t.dur)} · hámark ${String(pk).replace(".",",")} ${FL[main][1]}</text>`;
  return s+`</svg><p class="note">${FL[main][0]} (${FL[main][1]}) á ${REG[t.r].n.toLowerCase()}, með óvissubili spár. Skyggða bilið er ferðin sjálf.</p>`;
}
function messages(d,alt){
  const t=d.t,nd=alt.next;const when=`${dayLbl(d.h)} kl. ${hhmm(d.h)}`;
  const M={
   en:`Hi {first name},\n\nStrong winds are forecast during your ${t.name} on ${when.replace("kl.","at")}. Safety comes first, so we'd like to offer you a better day:\n\n${nd?`• Move to ${dayLbl(nd.h)} at ${hhmm(nd.h)} (forecast looks good: ${pct(nd.R.go)})\n`:""}${alt.alt?`• Switch to ${alt.alt.t.name} instead\n`:""}• Or keep your booking. We'll confirm by ${hhmm(deadline(d.h))}.\n\nTap to choose: arctic.link/r/8KQ2`,
   de:`Hallo {Vorname},\n\nfür Ihre Tour ${t.name} am ${when.replace("kl.","um")} ist starker Wind vorhergesagt. Wir bieten Ihnen gern einen besseren Termin an:\n\n${nd?`• Umbuchen auf ${dayLbl(nd.h)} um ${hhmm(nd.h)}\n`:""}${alt.alt?`• Stattdessen ${alt.alt.t.name}\n`:""}• Oder Buchung behalten – Bestätigung bis ${hhmm(deadline(d.h))}.\n\nAuswählen: arctic.link/r/8KQ2`,
   is:`Hæ {fornafn},\n\nSpáð er hvassviðri í ferðinni ${t.name} ${when}. Öryggið er í fyrirrúmi og við bjóðum þér betri dag:\n\n${nd?`• Færa á ${dayLbl(nd.h)} kl. ${hhmm(nd.h)}\n`:""}${alt.alt?`• Skipta yfir í ${alt.alt.t.name}\n`:""}• Eða halda bókun – staðfest fyrir kl. ${hhmm(deadline(d.h))}.\n\nVelja hér: arctic.link/r/8KQ2`};
  return M[lang];
}
function drawDetail(all){
  if(!selKey||!all.find(d=>d.key===selKey))selKey=all.slice().sort((a,b)=>b.R.cancel-a.R.cancel)[0].key;
  const d=all.find(x=>x.key===selKey),t=d.t,R=d.R;
  const rev=d.pax*t.price;const atRisk=rev*R.cancel;
  const nexts=all.filter(x=>x.t.id===t.id&&x.h>d.h&&x.R.status==="go").sort((a,b)=>a.h-b.h);
  const next=nexts[0];const alts=all.filter(x=>x.t.id!==t.id&&Math.abs(x.h-d.h)<=6&&x.R.status==="go"&&x.t.cap-x.pax>4).sort((a,b)=>b.t.price-a.t.price);
  const alt=alts[0];
  const seats=next?Math.max(0,next.t.cap-next.pax):0;
  const rebook=next?Math.min(d.pax,Math.round(seats*0.9)):0;
  const altSeats=alt?Math.min(d.pax-rebook,alt.t.cap-alt.pax):0;
  const recovered=rebook*t.price*.92+altSeats*(alt?alt.t.price:0)*.35;
  const acts=[];
  if(R.status==="go")acts.push({h:"Engin aðgerð þarf",d:"Spáin er innan marka þessarar ferðar. Vöktun heldur áfram og þú færð tilkynningu ef staðan breytist."});
  else{
    acts.push({h:"Senda gestum snemmbúna viðvörun",d:`${d.pax} gestir fá skilaboð á sínu tungumáli (SMS + tölvupóstur) með valkostum. Reynsla sýnir að 70% velja innan 2 klst.`,b:"Senda"});
    acts.push(next?{h:`Bjóða endurbókun · ${dayLbl(next.h)} ${hhmm(next.h)}`,d:`${seats} laus sæti, ${pct(next.R.go)} líkur á að sú ferð fari fram. Sætin eru tekin frá í 6 klst.`,b:"Taka frá"}:{h:"Bjóða inneign",d:"Engin örugg brottför innan 72 klst. Inneign með 18 mánaða gildistíma heldur tekjunum inni.",b:"Bjóða"});
    if(alt)acts.push({h:`Bjóða varaferð · ${alt.t.name}`,d:`${alt.t.cap-alt.pax} laus sæti ${hhmm(alt.h)}, ${pct(alt.R.go)} líkur á að hún fari fram. Mismunur á verði: ${fmtISK(alt.t.price-t.price)}.`,b:"Bjóða"});
    acts.push({h:"Láta leiðsögn og bílstjóra vita",d:"Vaktaplan uppfærist sjálfkrafa þegar ákvörðun er staðfest.",b:"Undirbúa"});
  }
  const fx=R.parts.map(p=>`<tr><td>${FL[p.k][0]}</td><td class="num ${p.v>=p.lo?"over":""}">${String(p.v).replace(".",",")} ${FL[p.k][1]}</td><td class="num">${p.lo}–${p.hi}</td><td class="num"><span class="mini"><i style="width:${p.r*100}%;background:${p.r>.6?"var(--cancel)":p.r>.2?"var(--change)":"var(--go)"}"></i></span></td></tr>`).join("");
  const el=document.getElementById("brottfor");
  el.innerHTML=`
   <div class="ph"><div><h2>${t.name}</h2><span class="s">${dayLbl(d.h)} · kl. ${hhmm(d.h)}–${hhmm(d.h+t.dur)} · ${TYPES[t.type].n} · ${REG[t.r].n} · ${d.pax}/${t.cap} sæti bókuð</span></div>
     <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pill p-${R.status}">${STAT[R.status]}</span><span class="pill" style="background:var(--sunk);color:var(--muted)">Ákvörðunarfrestur ${dayLbl(deadline(d.h))} ${hhmm(deadline(d.h))}</span></div></div>
   <div class="detail">
    <div class="dsec">
      <div><h3>Líkur á útkomu</h3>
       <div class="outcome">
        <div class="oc ${R.status==="go"?"hl":""}" style="color:var(--go)"><div class="l">Fer fram</div><div class="v">${pct(R.go)}</div></div>
        <div class="oc ${R.status==="change"?"hl":""}" style="color:var(--change)"><div class="l">Seinkun / breyting</div><div class="v">${pct(R.change)}</div></div>
        <div class="oc ${R.status==="cancel"?"hl":""}" style="color:var(--cancel)"><div class="l">Aflýst</div><div class="v">${pct(R.cancel)}</div><div class="u">±${Math.round(R.unc*100)} prósentustig</div></div>
       </div></div>
      <div><h3>Spá yfir ferðartímann · ráðandi þáttur</h3>${chartFor(d)}</div>
      <div><h3>Hvað ræður spánni</h3>
       <table class="fx"><tr><th>Þáttur</th><th class="num">Hámark í ferð</th><th class="num">Áhættubil</th><th class="num">Vægi</th></tr>${fx}</table>
       <p class="note" style="margin-top:6px">Áhættubil lærast af 214 fyrri brottförum þessarar ferðar (2023–2026). Spágæði fyrir þessa staðsetningu og fyrirvara: 87% réttar ákvarðanir.</p></div>
    </div>
    <div class="dsec">
      <div><h3>Fjárhagsleg áhrif</h3>
       <table class="fx">
        <tr><td>Bókaðar tekjur</td><td class="num">${fmtISK(rev)}</td></tr>
        <tr><td>Væntar endurgreiðslur án aðgerða</td><td class="num ${R.cancel>.2?"over":""}">${fmtISK(atRisk)}</td></tr>
        <tr><td>Endurbókanir (áætlað)</td><td class="num">${rebook} gestir</td></tr>
        <tr><td>Varaferðir (áætlað)</td><td class="num">${altSeats} gestir</td></tr>
        <tr><td><b>Endurheimt með Veðurvaka</b></td><td class="num" style="color:var(--go);font-weight:600">${fmtISK(R.status==="go"?0:Math.min(recovered,rev)*R.cancel)}</td></tr>
       </table></div>
      <div><h3>Tillögur að aðgerðum</h3>
       <div class="actions">${acts.map((a,i)=>{const k=selKey+"-"+i;const dn=done.has(k);return `<div class="act"><span class="no">${i+1}</span><div><div class="h">${a.h}</div><div class="d">${a.d}</div></div>${a.b?`<button class="btn ${dn?"done":""}" data-k="${k}">${dn?"Gert ✓":a.b}</button>`:""}</div>`}).join("")}</div></div>
      ${R.status!=="go"?`<div><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">Skilaboð til gesta · forskoðun</h3>
        <div class="tabs" role="group" aria-label="Tungumál">${["en","de","is"].map(l=>`<button aria-pressed="${l===lang}" data-l="${l}">${l.toUpperCase()}</button>`).join("")}</div></div>
        <div class="msg" style="margin-top:8px"><div class="hd"><span>SMS + tölvupóstur · ${d.pax} viðtakendur</span><span>Sendist ${hhmm(Math.max(NOW+1,deadline(d.h)-10))} ef samþykkt</span></div>${messages(d,{next,alt})}</div></div>`:""}
      <p class="note">Veðurvaki mælir með. Vaktstjóri staðfestir alltaf aflýsingu af öryggisástæðum og ákvörðunin er skráð.</p>
    </div>
   </div>`;
  el.querySelectorAll(".act .btn").forEach(b=>b.onclick=()=>{done.add(b.dataset.k);drawDetail(D())});
  el.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{lang=b.dataset.l;drawDetail(D())});
}

// ---------- season
function drawSeason(){
  const wk=[["1.–7. sep",.6],["8.–14. sep",1.4],["15.–21. sep",.9],["22.–28. sep",2.8],["29. sep–4. okt",3.6]];
  const W=520,H=190,L=34,B=34,T=14;const mx=4;const bw=(W-L-10)/wk.length;
  let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Endurheimtar tekjur á viku">`;
  for(let v=0;v<=mx;v++){const y=T+(1-v/mx)*(H-T-B);s+=`<line x1="${L}" x2="${W-10}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width=".7"/><text x="${L-6}" y="${y+3}" text-anchor="end" font-family="IBM Plex Mono,monospace" font-size="9" fill="var(--muted)">${v}</text>`}
  wk.forEach(([l,v],i)=>{const x=L+i*bw+bw*.2,w=bw*.6,y=T+(1-v/mx)*(H-T-B);
    s+=`<rect x="${x}" y="${y}" width="${w}" height="${H-B-y}" rx="2" fill="${i===wk.length-1?"var(--accent)":"color-mix(in srgb,var(--accent) 55%,var(--panel))"}"/>
    <text x="${x+w/2}" y="${y-5}" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="10" fill="var(--ink)">${String(v).replace(".",",")}</text>
    <text x="${x+w/2}" y="${H-B+14}" text-anchor="middle" font-family="IBM Plex Sans,sans-serif" font-size="9.5" fill="var(--muted)">${l}</text>`});
  document.getElementById("seasonchart").innerHTML=s+`</svg><p class="note">Haustlægðir byrja seint í september. Samtals 9,3 m.kr. á fimm vikum.</p>`;
  const kv=[["Brottfarir vaktaðar","1.284"],["Veðurtengdar aflýsingar","61"],["Þar af ákveðnar ≥ 24 klst. fyrir","48 (79%)"],["Gestir endurbókaðir","1.112 af 1.736 (64%)"],["Varaferðir seldar","187"],["Endurheimtar tekjur","9,3 m.kr."],["Endurgreiðslur sem féllu niður","−7,1 m.kr."],["Tímar spöruð í þjónustuveri","≈ 140 klst."]];
  document.getElementById("seasonkv").innerHTML=kv.map(([a,b])=>`<dt>${a}</dt><dd>${b}</dd>`).join("");
}
