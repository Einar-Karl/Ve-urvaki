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
  const al=document.getElementById("alert");const riskyPax=risky.reduce((s,d)=>s+d.pax,0);
  const calm=peak.g<20&&!risky.length;
  al.className="alert"+(calm?" calm":"");
  al.innerHTML=calm
    ?`<div class="ic">✓</div><div class="t"><b>Engin veruleg veðuráhætta næstu 72 klst.</b> Mestu hviður ${Math.round(peak.g)} m/s á ${REG[peak.r].n.toLowerCase()} ${dayLbl(peak.h)} um kl. ${hhmm(peak.h)}.</div><button class="btn" id="toQ">Sjá röð</button>`
    :`<div class="ic">!</div><div class="t"><b>Hvassviðri í spánni.</b> Hviður allt að ${Math.round(peak.g)} m/s á ${REG[peak.r].n.toLowerCase()} ${dayLbl(peak.h)} um kl. ${hhmm(peak.h)}. ${risky.length} brottfarir með ${riskyPax} gestum þurfa ákvörðun.</div><button class="btn primary" id="toQ">Fara yfir röð</button>`;
  document.getElementById("toQ").onclick=()=>document.getElementById("queue").scrollIntoView({behavior:"smooth",block:"center"});
}

// ---------- detail
function chartFor(d){
  const t=d.t,f=tourF(t),main=d.R.parts[0].k;const [lo,hi]=f[main];
  const h0=Math.max(0,d.h-18),h1=Math.min(71,d.h+t.dur+18);const vals=[];for(let h=h0;h<=h1;h++)vals.push([h,wx(siteOf(t),h)[main]]);
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
  if(!all.length){document.getElementById("brottfor").innerHTML=`<div class="ph"><h2>Brottför</h2></div><div class="dsec"><p class="note">Engar bókaðar brottfarir næstu 72 klst.${BOOKINGS&&BOOKINGS.mode==="live"?" (samkvæmt Bókun)":""}</p></div>`;return}
  if(!selKey||!all.find(d=>d.key===selKey))selKey=all.slice().sort((a,b)=>b.R.cancel-a.R.cancel)[0].key;
  const d=all.find(x=>x.key===selKey),t=d.t,R=d.R;
  const rev=d.pax*t.price;const atRisk=rev*R.cancel;
  const nexts=all.filter(x=>x.t.id===t.id&&x.h>d.h&&x.R.status==="go").sort((a,b)=>a.h-b.h);
  const next=nexts[0];const alts=all.filter(x=>x.t.id!==t.id&&Math.abs(x.h-d.h)<=6&&x.R.status==="go"&&capOf(x)-x.pax>4).sort((a,b)=>b.t.price-a.t.price);
  const alt=alts[0];
  const seats=next?Math.max(0,capOf(next)-next.pax):0;
  const rebook=next?Math.min(d.pax,Math.round(seats*0.9)):0;
  const altSeats=alt?Math.min(d.pax-rebook,capOf(alt)-alt.pax):0;
  const recovered=rebook*t.price*.92+altSeats*(alt?alt.t.price:0)*.35;
  const acts=[];
  if(R.status==="go")acts.push({h:"Engin aðgerð þarf",d:"Spáin er innan marka þessarar ferðar. Vöktun heldur áfram og þú færð tilkynningu ef staðan breytist."});
  else{
    acts.push({h:"Senda gestum snemmbúna viðvörun",d:`${d.pax} gestir fá skilaboð á sínu tungumáli (SMS + tölvupóstur) með valkostum. Reynsla sýnir að 70% velja innan 2 klst.`,b:"Senda"});
    acts.push(next?{h:`Bjóða endurbókun · ${dayLbl(next.h)} ${hhmm(next.h)}`,d:`${seats} laus sæti, ${pct(next.R.go)} líkur á að sú ferð fari fram. Sætin eru tekin frá í 6 klst.`,b:"Taka frá"}:{h:"Bjóða inneign",d:"Engin örugg brottför innan 72 klst. Inneign með 18 mánaða gildistíma heldur tekjunum inni.",b:"Bjóða"});
    if(alt)acts.push({h:`Bjóða varaferð · ${alt.t.name}`,d:`${capOf(alt)-alt.pax} laus sæti ${hhmm(alt.h)}, ${pct(alt.R.go)} líkur á að hún fari fram. Mismunur á verði: ${fmtISK(alt.t.price-t.price)}.`,b:"Bjóða"});
    acts.push({h:"Láta leiðsögn og bílstjóra vita",d:"Vaktaplan uppfærist sjálfkrafa þegar ákvörðun er staðfest.",b:"Undirbúa"});
  }
  const fx=R.parts.map(p=>`<tr><td>${FL[p.k][0]}</td><td class="num ${p.v>=p.lo?"over":""}">${String(p.v).replace(".",",")} ${FL[p.k][1]}</td><td class="num">${p.lo}–${p.hi}</td><td class="num"><span class="mini"><i style="width:${p.r*100}%;background:${p.r>.6?"var(--cancel)":p.r>.2?"var(--change)":"var(--go)"}"></i></span></td></tr>`).join("");
  const el=document.getElementById("brottfor");
  el.innerHTML=`
   <div class="ph"><div><h2>${t.name}</h2><span class="s">${dayLbl(d.h)} · kl. ${hhmm(d.h)}–${hhmm(d.h+t.dur)} · ${TYPES[t.type].n} · ${REG[t.r].n} · ${d.pax}/${capOf(d)} sæti bókuð</span></div>
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
       <p class="note" style="margin-top:6px">${extraNotes(d)}${modelNote(t)}</p></div>
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
      ${decisionBlock(d)}
      <div><h3>Tillögur að aðgerðum</h3>
       <div class="actions">${acts.map((a,i)=>{const k=selKey+"-"+i;const dn=done.has(k);return `<div class="act"><span class="no">${i+1}</span><div><div class="h">${a.h}</div><div class="d">${a.d}</div></div>${a.b?`<button class="btn ${dn?"done":""}" data-k="${k}">${dn?"Gert ✓":a.b}</button>`:""}</div>`}).join("")}</div><p class="note" style="margin-top:6px">Hnapparnir merkja aðeins verkið sem unnið. SMS, tölvupóstur og breytingar í Bókun eru ekki tengd enn.</p></div>
      ${R.status!=="go"?`<div><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">Skilaboð til gesta · forskoðun</h3>
        <div class="tabs" role="group" aria-label="Tungumál">${["en","de","is"].map(l=>`<button aria-pressed="${l===lang}" data-l="${l}">${l.toUpperCase()}</button>`).join("")}</div></div>
        <div class="msg" style="margin-top:8px"><div class="hd"><span>SMS + tölvupóstur · ${d.pax} viðtakendur</span><span>Sendist ${hhmm(Math.max(NOW+1,deadline(d.h)-10))} ef samþykkt</span></div>${messages(d,{next,alt})}</div></div>`:""}
      <p class="note">Veðurvaki mælir með. Vaktstjóri staðfestir alltaf aflýsingu af öryggisástæðum og ákvörðunin er skráð.</p>
    </div>
   </div>`;
  el.querySelectorAll(".act .btn").forEach(b=>b.onclick=()=>{done.add(b.dataset.k);drawDetail(D())});
  el.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{lang=b.dataset.l;drawDetail(D())});
  el.querySelectorAll(".decide .btn").forEach(b=>b.onclick=()=>recordOutcome(d,b.dataset.o));
}

// ---------- status, notes, history, connections
const IS_DAY=["Sunnudagur","Mánudagur","Þriðjudagur","Miðvikudagur","Fimmtudagur","Föstudagur","Laugardagur"];
const IS_MON=["janúar","febrúar","mars","apríl","maí","júní","júlí","ágúst","september","október","nóvember","desember"];
const $=id=>document.getElementById(id);
const esc=x=>String(x??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function drawStatus(){
  const m=FC_META.mode,live=m==="live";
  const g=FC_META.generatedAt?new Date(FC_META.generatedAt):null;
  const hm=g?String(g.getUTCHours()).padStart(2,"0")+":"+String(g.getUTCMinutes()).padStart(2,"0"):"";
  const ok=(FC_META.sources||[]).filter(s=>s.ok).map(s=>s.label);
  $("st-live").className="live"+(live?"":" off");
  $("st-live").innerHTML=`<i></i><b>${live?"Spá sótt "+hm+" (UTC)":m==="demo"?"Sýnigögn · engin tenging við veðurþjónustur":"Innbyggð sýnigögn · enginn netþjónn"}</b>`;
  $("st-models").textContent=live?"Heimildir: "+ok.join(" + "):"Veðurlíkan: tilbúin sýnigögn";
  const bm=BOOKINGS&&BOOKINGS.mode,bt=BOOKINGS&&BOOKINGS.fetchedAt?new Date(BOOKINGS.fetchedAt):null;
  $("st-book").textContent=(bm==="live"?`Bókanir: Bókun · sótt ${String(bt.getUTCHours()).padStart(2,"0")}:${String(bt.getUTCMinutes()).padStart(2,"0")}`
    :bm==="ingested"?"Bókanir: innsendar (CSV / API)":"Bókanir: sýnigögn (engin tenging við bókunarkerfi)")+(TOURS_DEMO?" · ferðalisti: sýnidæmi":"");
  const d=hDate(NOW);$("st-date").textContent=`${IS_DAY[d.getUTCDay()]} ${d.getUTCDate()}. ${IS_MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const b=$("badge");b.className="proto"+(live?" live":"");
  b.textContent=live?"Beint · veðurgögn":m==="demo"?"Sýnigögn":"Prótótýpa · sýnigögn";
  b.title=live?"Veðurgögn eru sótt beint. Bókanir og verð eru enn sýnigögn.":(FC_META.demoReason||"");
  const att=[...new Set((FC_META.sources||[]).filter(s=>s.ok&&s.attribution).map(s=>s.attribution))];
  if(HIST&&HIST.mode==="live"&&HIST.attribution)att.push(HIST.attribution);
  $("attr").textContent=att.length?"Gagnaheimildir: "+[...new Set(att)].join(" · "):"";
}

function extraNotes(d){
  const out=[],t=d.t;
  const o=OBS&&(OBS[siteOf(t)]||OBS[t.r]);
  if(o&&(o.g!=null||o.w!=null))out.push(`Mæling núna${o.name?" ("+esc(o.name)+(o.km!=null?", "+o.km+" km":"")+")":""}: ${o.g!=null?"hviður "+String(o.g).replace(".",",")+" m/s":"vindur "+String(o.w).replace(".",",")+" m/s"}.`);
  if(t.type==="aurora"&&KP&&KP.length){
    const at=hDate(d.h).getTime();const k=KP.reduce((b,x)=>Math.abs(new Date(x.t)-at)<Math.abs(new Date(b.t)-at)?x:b);
    if(Math.abs(new Date(k.t)-at)<=6*3600e3)out.push(`Kp-gildi nálægt brottför: ${String(k.kp).replace(".",",")} (NOAA).`);
  }
  const rd=ROADS&&ROADS[t.r];if(rd&&rd.length)out.push(`Vegagerðin: ${rd.length} atvik á svæðinu, þar af ${rd.filter(r=>r.closed).length} lokanir.`);
  return out.length?out.join(" ")+" ":"";
}

// Daily maxima of gust inside a tour's operating window, from the hourly history series.
function dailyMax(region,from,to){
  const a=HIST&&HIST.regions[region];if(!a)return[];
  const g=a.g,n=Math.floor(g.length/24),out=[];
  for(let d=0;d<n;d++){let m=null;for(let h=from;h<to;h++){const v=g[d*24+h];if(v!=null&&(m==null||v>m))m=v}out.push(m)}
  return out;
}
const tourWindow=t=>[Math.min(...t.dep),Math.min(24,Math.max(...t.dep)+t.dur)];

function drawHistory(){
  const el=$("sagabody");
  if(!HIST){el.innerHTML=`<div class="dsec"><p class="note">Söguleg gögn ekki tiltæk (enginn netþjónn).</p></div>`;return}
  const start=new Date(HIST.start),days=HIST.days;
  const dl=i=>{const d=new Date(start.getTime()+i*86400e3);return `${d.getUTCDate()}. ${MON[d.getUTCMonth()]}`};
  $("sagasub").textContent=`${dl(0)} – ${dl(days-1)} · ${HIST.mode==="live"?"ERA5 endurgreining (Open-Meteo)":"sýnigögn"} · dagtími ferðar`;
  const tourId=parseInt(selKey)||1,sel=TOURS.find(t=>t.id===tourId)||TOURS[0];
  const rows=TOURS.map(t=>{const [lo,hi]=tourF(t).g,[a,b]=tourWindow(t),dm=dailyMax(siteOf(t),a,b);
    return {t,lo,hi,over:dm.filter(v=>v!=null&&v>=hi).length,warn:dm.filter(v=>v!=null&&v>=lo&&v<hi).length,n:dm.filter(v=>v!=null).length}}).sort((x,y)=>y.over-x.over||y.warn-x.warn);
  const bars=rows.map(r=>`<tr class="${r.t.id===sel.id?"sel":""}"><td>${esc(r.t.name)}</td><td class="num">${r.over} af ${r.n}</td>
    <td><span class="hbar"><i style="width:${r.over/Math.max(1,r.n)*100}%;background:var(--cancel)"></i><i style="width:${r.warn/Math.max(1,r.n)*100}%;background:var(--change)"></i></span></td></tr>`).join("");
  // chart for the selected tour
  const [lo,hi]=tourF(sel).g,[wa,wb]=tourWindow(sel),dm=dailyMax(siteOf(sel),wa,wb);
  const W=520,H=190,L=34,B=26,T=12,vmax=Math.max(hi*1.2,...dm.filter(v=>v!=null))*1.05,bw=(W-L-8)/Math.max(1,dm.length);
  const y=v=>T+(1-v/vmax)*(H-T-B);
  let c=`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Hæsta hviða á dag, ${esc(sel.name)}">`;
  for(let i=0;i<=4;i++){const v=vmax/4*i;c+=`<line x1="${L}" x2="${W-8}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width=".7"/><text x="${L-6}" y="${y(v)+3}" text-anchor="end" font-family="IBM Plex Mono,monospace" font-size="9" fill="var(--muted)">${Math.round(v)}</text>`}
  dm.forEach((v,i)=>{if(v==null)return;const col=v>=hi?"var(--cancel)":v>=lo?"var(--change)":"var(--go)";
    c+=`<rect x="${L+i*bw+1}" y="${y(v)}" width="${Math.max(1,bw-2)}" height="${H-B-y(v)}" rx="1.5" fill="${col}" opacity=".85"><title>${dl(i)}: ${String(Math.round(v*10)/10).replace(".",",")} m/s</title></rect>`;
    if(i%5===0)c+=`<text x="${L+i*bw+bw/2}" y="${H-10}" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="9" fill="var(--muted)">${dl(i)}</text>`});
  c+=`<line x1="${L}" x2="${W-8}" y1="${y(lo)}" y2="${y(lo)}" stroke="var(--change)" stroke-dasharray="4 3"/><line x1="${L}" x2="${W-8}" y1="${y(hi)}" y2="${y(hi)}" stroke="var(--cancel)" stroke-dasharray="4 3"/>
    <text x="${W-10}" y="${y(hi)-4}" text-anchor="end" font-family="IBM Plex Sans,sans-serif" font-size="9" fill="var(--cancel)">Aflýsingarmörk ${hi}</text></svg>`;
  // facts across all regions
  let peak={g:-1};for(const r in HIST.regions){if(!REG[r])continue;HIST.regions[r].g.forEach((v,i)=>{if(v!=null&&v>peak.g)peak={g:v,r,i}})}
  const sr=rows.find(r=>r.t.id===sel.id);
  const kv=[["Tímabil",`${dl(0)} – ${dl(days-1)}`],["Valin ferð",esc(sel.name)],["Dagar yfir aflýsingarmörkum",`${sr.over} af ${sr.n}`],["Dagar í áhættubili",`${sr.warn} af ${sr.n}`],
    ["Mesta hviða á landinu",peak.g<0?"–":`${String(Math.round(peak.g*10)/10).replace(".",",")} m/s · ${REG[peak.r].n}, ${dl(Math.floor(peak.i/24))}`],["Heimild",HIST.mode==="live"?"Open-Meteo / ERA5":"Sýnigögn"]];
  el.innerHTML=`<div class="dsec"><h3>Hæsta hviða á dag · ${esc(sel.name)}</h3>${c}<p class="note">Hæsta hviða á ferðatíma hvers dags (kl. ${hhmm(wa)}–${hhmm(wb)}). Grænt: undir áhættumörkum, gult: í áhættubili, rautt: yfir sögulegum aflýsingarmörkum ferðartegundar.</p></div>
    <div class="dsec"><h3>Dagar yfir aflýsingarmörkum eftir ferð</h3><table class="fx hist"><tbody>${bars}</tbody></table>
    <dl class="kv">${kv.map(([a,b])=>`<dt>${a}</dt><dd>${b}</dd>`).join("")}</dl></div>`;
}

function drawConnections(){
  const el=$("tengbody");if(!el)return;
  const mode=FC_META.mode;
  $("tengsub").textContent=mode==="live"?"Veðurgögn sótt beint":mode==="demo"?"Sýnigögn í notkun: "+(FC_META.demoReason||""):"Enginn netþjónn tengdur";
  const warn=TOUR_WARNINGS.length?`<div class="warnbox"><b>Athugasemdir um config/tours.json</b><ul>${TOUR_WARNINGS.map(w=>`<li>${esc(w)}</li>`).join("")}</ul></div>`:"";
  if(!HEALTH){el.innerHTML=`<p class="note" style="padding:14px 18px">Netþjónn er ekki í gangi. Keyrðu <code>npm start</code> og opnaðu síðuna í gegnum hann til að sjá stöðu tenginga.</p>`;return}
  const pill={ok:["p-go","Tengt"],error:["p-cancel","Villa"],unconfigured:["p-change","Ekki stillt"]};
  el.innerHTML=warn+`<table class="fx conn"><thead><tr><th>Heimild</th><th>Tegund</th><th>Staða</th><th>Nánar</th><th>Leyfi</th></tr></thead><tbody>${HEALTH.map(c=>{const [cl,tx]=pill[c.status]||pill.error;
    return `<tr><td><b>${esc(c.label)}</b></td><td>${c.kinds.map(esc).join(", ")}</td><td><span class="pill ${cl}">${tx}</span>${c.ms!=null&&c.status==="ok"?` <span class="mono">${c.ms} ms</span>`:""}</td><td class="det">${esc(c.detail)}</td><td class="det">${esc(c.license)}</td></tr>`}).join("")}</tbody></table>`;
}

// ---------- learned thresholds and decision log
function modelNote(t){
  const m=MODEL&&MODEL.tours&&MODEL.tours[t.id];
  if(m&&m.status==="learned")return `Áhættumörk lærð af ${m.n} ákvörðunum (50% aflýsingarlíkur við ${String(m.p50).replace(".",",")} m/s hviður). `;
  return `Áhættumörk eru ${t.f0?"stillt handvirkt":"sjálfgefin"}${m?` (${m.n} ákvarðanir skráðar, ${m.cancelled} aflýsingar; þarf fleiri til að læra)`:""}; þau lærast af ákvörðunum vaktstjóra. `;
}
function decisionBlock(d){
  const iso=depIso(d),last=DECISIONS[d.t.id+"|"+iso],off=FC_META.mode==="embedded"?" disabled":"";
  const lab={ran:"Fer fram",cancelled:"Aflýst",changed:"Breytt / fært"};
  let who="";try{who=localStorage.getItem("vv-who")||""}catch(e){}
  const when=last?new Date(last.decidedAt||last.receivedAt):null;
  const hint=FC_META.mode==="embedded"?"Netþjónn þarf að vera í gangi til að skrá ákvörðun."
    :FC_META.mode==="demo"?"Sýnigögn: ákvörðun er skráð en ekki notuð til þjálfunar."
    :"Skráð með spánni sem sést á skjánum og notuð til að læra áhættumörkin.";
  return `<div><h3>Ákvörðun vaktstjóra</h3>
    <div class="decide"><input id="who" class="who" placeholder="Nafn vaktstjóra" value="${esc(who)}" aria-label="Nafn vaktstjóra"${off}>
    <button class="btn" data-o="cancelled"${off}>Staðfesta aflýsingu</button><button class="btn" data-o="ran"${off}>Staðfesta brottför</button><button class="btn" data-o="changed"${off}>Breyting</button></div>
    <p class="note" style="margin-top:6px">${last?`Skráð: <b>${lab[last.outcome]||esc(last.outcome)}</b>${last.decidedBy?" · "+esc(last.decidedBy):""} · ${String(when.getUTCHours()).padStart(2,"0")}:${String(when.getUTCMinutes()).padStart(2,"0")}. `:"Engin ákvörðun skráð. "}${hint}</p></div>`;
}
