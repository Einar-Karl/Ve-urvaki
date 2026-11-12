// Guided simulation ("Hermun"): walks through one stormy morning for the duty manager, on the real dashboard.
// It drives the existing views (time slider, map, queue, departure detail) and shows what the system would
// send and receive. Nothing is written or sent: no decision is stored, no message or webhook leaves the browser.
// Start with the "Hermun" button in the top bar, or open /?hermun.
let SIM=null;

const SIMTXT={
  is:{
    title:"Hermun · stormdagur", banner:"HERMUN: ekkert er vistað eða sent", prev:"Til baka", next:"Áfram", auto:"Spila sjálfvirkt", stop:"Stöðva",
    close:"Loka", done:"Ljúka", feed:"Það sem kerfið gerir", lang:"English",
    s:[
      d=>["07:00 · Vaktstjóri mætir",`Í stað þess að opna fimm veðursíður, Vegagerðina og Bókun sér vaktstjórinn allar ${d.n} brottfarir næstu 72 klst. á einum skjá, metnar eftir veðri á sjálfum brottfararstaðnum.`],
      d=>["Lægð nálgast",`Kortið spilar spána fram að ${d.when}. Vindörvar sýna hviður um allt land; tölurnar í pinnunum eru líkur á aflýsingu. Við ${d.place} fara hviður í ${d.gust} m/s.`],
      d=>["Ákvörðunarröðin",`Brottfarir raðast eftir fresti og áhættu. Efst er <b>${d.tour}</b> ${d.when}: <b>${d.cancel}</b> líkur á aflýsingu. Ákveða þarf fyrir <b>${d.deadline}</b>, áður en gestir leggja af stað.`],
      d=>["Af hverju?",`Kerfið sýnir ástæðuna: ${d.driver}. Fjögur veðurlíkön (ECMWF, DMI 2 km, ICON, MET Norway) eru borin saman; ef þau eru ósammála breikkar óvissan og kerfið segir það.`],
      d=>["Vegir og myndavélar",`Vegagerðin er skoðuð sjálfkrafa. Ef vegur sem ferðin þarf lokast fer hún strax í „Aflýsing líkleg“. Myndavélar nálægt staðnum sjást beint úr brottförinni.`],
      d=>["Vaktstjóri ákveður",`Vaktstjórinn staðfestir aflýsingu með spána á skjánum. Kerfið skráir hver ákvað og hvenær og lætur önnur kerfi vita.`],
      d=>["Gestir fá skilaboð",`${d.pax} gestir fá SMS og tölvupóst á sínu tungumáli (EN/DE/IS) með einkahlekk þar sem þeir velja sjálfir: nýja dagsetningu, aðra ferð, inneign eða endurgreiðslu.`],
      d=>["Gestir velja",`Á næstu klukkustundum velja gestirnir. Starfsfólk fær lista yfir það sem þarf að gera í Bókun, í stað þess að hringja í hvern og einn.`],
      d=>["Niðurstaða",`Án aðgerða væri <b>${d.revenue}</b> endurgreitt. Hér: <b>${d.split[0]}</b> gestir færðir á nýjan dag, <b>${d.split[1]}</b> í aðra ferð, <b>${d.split[2]}</b> fá inneign og <b>${d.split[3]}</b> endurgreitt (${d.refund}). Áætluð endurheimt er <b>${d.recovered}</b>, sama mat og í brottförinni. Og ákvörðunin var tekin ${d.lead} fyrr en annars.`],
      d=>["Kerfið lærir",`Útkoman er skráð. Á nóttunni lærir kerfið mörk hverrar ferðar út frá raunverulegum ákvörðunum ykkar. Næsta skref: 2–4 vikur í skuggaham þar sem kerfið keyrir við hlið vaktstjóra og árangurinn er borinn saman.`],
    ],
    ev:{start:"Spá sótt: ECMWF · DMI 2 km · ICON · GFS · MET Norway",roads:"Vegagerðin: staða vega og veðurstöðva sótt",risk:"Áhætta reiknuð fyrir allar brottfarir",
      changed:"Webhook departure.risk_changed → bókunarkerfi",decided:"Ákvörðun skráð: aflýst",hook:"Webhook decision.recorded → Bókun / CRM",guides:"Leiðsögumenn og bílstjórar látnir vita",
      sms:n=>`SMS + tölvupóstur til ${n} gesta (dry-run)`,choice:"Webhook guest.choice_made",resolved:"Webhook case.resolved",learn:"Útkoma vistuð fyrir næturþjálfun"},
    choices:["Ný dagsetning","Önnur ferð","Inneign","Endurgreiðsla"],
  },
  en:{
    title:"Simulation · storm day", banner:"SIMULATION: nothing is saved or sent", prev:"Back", next:"Next", auto:"Play", stop:"Stop",
    close:"Close", done:"Finish", feed:"What the system does", lang:"Íslenska",
    s:[
      d=>["07:00 · The duty manager arrives",`Instead of opening five weather sites, the road authority and the booking system, the duty manager sees all ${d.n} departures in the next 72 hours on one screen, judged by the weather at each meeting point.`],
      d=>["A low is coming in",`The map plays the forecast forward to ${d.when}. Arrows show gusts across Iceland; the numbers on the pins are the chance of cancellation. At ${d.place} gusts reach ${d.gust} m/s.`],
      d=>["The decision queue",`Departures are ranked by deadline and risk. At the top: <b>${d.tour}</b> ${d.when}, <b>${d.cancel}</b> chance of cancellation. The call must be made by <b>${d.deadline}</b>, before guests set off.`],
      d=>["Why?",`The system shows the reason: ${d.driver}. Four weather models (ECMWF, DMI 2 km, ICON, MET Norway) are compared; when they disagree, the uncertainty widens and the screen says so.`],
      d=>["Roads and cameras",`Road conditions are checked automatically. If a road the tour needs closes, it goes straight to "cancel likely". Cameras near the site open from the departure.`],
      d=>["The duty manager decides",`The duty manager confirms the cancellation with the forecast on screen. The system records who decided and when, and tells the other systems.`],
      d=>["Guests are told",`${d.pax} guests get an SMS and an email in their language (EN/DE/IS) with a private link to choose for themselves: a new date, another tour, a voucher or a refund.`],
      d=>["Guests choose",`Over the next hours the guests choose. Staff get a to-do list for the booking system instead of phoning everyone.`],
      d=>["The result",`Doing nothing would refund <b>${d.revenue}</b>. Here: <b>${d.split[0]}</b> guests moved to a new date, <b>${d.split[1]}</b> to another tour, <b>${d.split[2]}</b> take a voucher and <b>${d.split[3]}</b> are refunded (${d.refund}). Estimated recovery is <b>${d.recovered}</b>, the same estimate as the departure panel. And the decision was made ${d.lead} earlier.`],
      d=>["The system learns",`The outcome is recorded. Each night the system learns every tour's limits from your real decisions. Next step: 2–4 weeks in shadow mode, running beside the duty managers, then compare the results.`],
    ],
    ev:{start:"Forecast fetched: ECMWF · DMI 2 km · ICON · GFS · MET Norway",roads:"Road authority: road status and stations fetched",risk:"Risk calculated for every departure",
      changed:"Webhook departure.risk_changed → booking system",decided:"Decision recorded: cancelled",hook:"Webhook decision.recorded → booking system / CRM",guides:"Guides and drivers notified",
      sms:n=>`SMS + email to ${n} guests (dry run)`,choice:"Webhook guest.choice_made",resolved:"Webhook case.resolved",learn:"Outcome stored for nightly training"},
    choices:["New date","Other tour","Voucher","Refund"],
  },
};

const nIS=x=>Number(x).toLocaleString("de-DE",{maximumFractionDigits:1});
function simFacts(){
  const all=D();if(!all.length)return null;
  const w=all.slice().sort((a,b)=>b.R.cancel-a.R.cancel)[0],t=w.t,R=w.R;
  const nexts=all.filter(x=>x.t.id===t.id&&x.h>w.h&&x.R.status==="go").sort((a,b)=>a.h-b.h);
  const alts=all.filter(x=>x.t.id!==t.id&&Math.abs(x.h-w.h)<=6&&x.R.status==="go").sort((a,b)=>b.t.price-a.t.price);
  const p=R.parts[0]||{k:"g",v:0,lo:0,hi:0};
  const unit={g:"m/s",p:"mm/h",c:"%",s:"m",t:"°C"}[p.k]||"";
  const pax=w.pax,price=t.price||0;
  // Same estimate as the departure panel (views.js): free seats on the next safe departure and a safe alternative tour.
  // Of the guests left over, about 60% take a voucher (an assumption; real numbers come from your own cases).
  const next=nexts[0],alt=alts[0];
  const rebook=next?Math.min(pax,Math.round(Math.max(0,capOf(next)-next.pax)*0.9)):0;
  const altSeats=alt?Math.max(0,Math.min(pax-rebook,capOf(alt)-alt.pax)):0;
  const voucher=Math.round((pax-rebook-altSeats)*.6),split=[rebook,altSeats,voucher,pax-rebook-altSeats-voucher];
  const recovered=rebook*price*.92+altSeats*(alt?alt.t.price:0)*.35;
  const dl=deadline(w.h);
  return {w,next,alt,n:all.length,tour:t.name,place:t.name.split("·").pop().trim(),pax,split,
    when:`${dayLbl(w.h)} ${hhmm(w.h)}`,deadline:`${dayLbl(dl)} ${hhmm(dl)}`,cancel:pct(R.cancel),
    gust:Math.round(Math.max(...Array.from({length:(t.dur||3)+1},(_,i)=>wx(siteOf(t),w.h+i).g))),
    driver:lang==="is"?`${({g:"hviður",p:"úrkoma",c:"skýjahula",s:"ölduhæð",t:"hiti"})[p.k]||p.k} ${nIS(p.v)} ${unit} (áhætta hefst við ${nIS(p.lo)}, venjulega aflýst við ${nIS(p.hi)})`
      :`${({g:"gusts",p:"rain",c:"cloud",s:"waves",t:"temperature"})[p.k]||p.k} ${p.v} ${unit} (risk starts at ${p.lo}, usually cancelled at ${p.hi})`,
    revenue:fmtISK(pax*price),recovered:fmtISK(recovered),refund:fmtISK(split[3]*price),
    lead:lang==="is"?"nokkrum klukkustundum":"several hours"};
}

function simStart(){
  if(SIM)return;
  const prevLang=lang;
  // The dashboard is in Icelandic, so the walkthrough starts in Icelandic (English one click away, or /?hermun=en)
  const L=/hermun=en|sim=en/.test(location.search)?"en":"is";
  SIM={i:0,lang:L,prevLang,prevHour:hour,prevSel:selKey,timer:null,anim:null,feed:[]};
  document.body.classList.add("simon");
  const box=document.createElement("div");box.id="simbox";box.setAttribute("role","dialog");box.setAttribute("aria-label","Hermun");
  document.body.appendChild(box);
  const ban=document.createElement("div");ban.id="simbanner";document.body.appendChild(ban);
  document.addEventListener("keydown",simKeys);
  simShow(0);
}

function simKeys(e){if(!SIM)return;if(e.key==="Escape")simEnd();else if(e.key==="ArrowRight")simShow(SIM.i+1);else if(e.key==="ArrowLeft")simShow(SIM.i-1)}

function simEnd(){
  if(!SIM)return;clearInterval(SIM.timer);clearInterval(SIM.anim);
  document.removeEventListener("keydown",simKeys);
  ["simbox","simbanner","simphone"].forEach(id=>{const e=document.getElementById(id);if(e)e.remove()});
  document.querySelectorAll(".simfocus").forEach(e=>e.classList.remove("simfocus"));
  document.body.classList.remove("simon");
  lang=SIM.prevLang;hour=SIM.prevHour;selKey=SIM.prevSel;document.getElementById("hour").value=hour;
  SIM=null;render();
  try{history.replaceState(null,"",location.pathname)}catch(e){}
}

function focusOn(sel){
  document.querySelectorAll(".simfocus").forEach(e=>e.classList.remove("simfocus"));
  const el=typeof sel==="string"?document.querySelector(sel):sel;if(!el)return;
  el.classList.add("simfocus");
  const r=el.getBoundingClientRect(),boxH=(document.getElementById("simbox")||{}).offsetHeight||0;
  const narrow=innerWidth<900,room=narrow?innerHeight-boxH:innerHeight;
  window.scrollTo({top:Math.max(0,scrollY+r.top-(r.height<room-40?Math.max(70,(room-r.height)/2):70)),behavior:"smooth"});
}

function setHour(h){hour=clamp(h,0,71);document.getElementById("hour").value=hour;setTime();drawMap()}
function animateTo(target,done){
  clearInterval(SIM.anim);let h=hour;const step=target>=h?1:-1;
  SIM.anim=setInterval(()=>{if(!SIM||h===target){clearInterval(SIM&&SIM.anim);done&&done();return}h+=step;setHour(h)},140);
}

function feed(msg,kind){
  if(!SIM)return;const t=new Date(START.getTime()+hour*3600e3);
  SIM.feed.unshift({msg,kind:kind||"",at:`${String(t.getUTCHours()).padStart(2,"0")}:${String((SIM.feed.length*7)%60).padStart(2,"0")}`});
  SIM.feed=SIM.feed.slice(0,8);drawFeed();
}
function drawFeed(){const f=document.getElementById("simfeed");if(!f||!SIM)return;
  f.innerHTML=SIM.feed.map(x=>`<li class="${x.kind}"><span>${x.at}</span>${x.msg}</li>`).join("")}

function phone(d,T){
  let p=document.getElementById("simphone");if(p)p.remove();
  const prev=lang;lang="en";const txt=messages(d.w,{next:d.next,alt:d.alt});lang=prev;
  p=document.createElement("div");p.id="simphone";p.setAttribute("aria-label","SMS");
  p.innerHTML=`<div class="scr"><div class="from">Arctic Adventures</div><div class="bubble">${esc(txt).replace(/\n/g,"<br>")}</div>
    <div class="choices">${T.choices.map((c,i)=>`<span data-i="${i}">${c}</span>`).join("")}</div></div>`;
  document.body.appendChild(p);
}

function tally(d,T){
  const p=document.getElementById("simphone");if(!p)return;
  const sp=p.querySelectorAll(".choices span");let k=0;
  clearInterval(SIM.timer);
  SIM.timer=setInterval(()=>{if(!SIM||k>=4){clearInterval(SIM&&SIM.timer);return}
    sp[k].innerHTML=`${T.choices[k]} <b>${d.split[k]}</b>`;sp[k].classList.add("on");
    if(d.split[k])feed(`${SIMTXT[SIM.lang].ev.choice}: ${T.choices[k].toLowerCase()} × ${d.split[k]}`,"hook");k++},650);
}

function simShow(i){
  if(!SIM)return;const T=SIMTXT[SIM.lang];
  if(i<0)i=0;if(i>=T.s.length){simEnd();return}
  clearInterval(SIM.timer);clearInterval(SIM.anim);
  const back=i<SIM.i;SIM.i=i;lang=SIM.lang;
  const d=simFacts();if(!d){simEnd();return}
  const [h,body]=T.s[i](d);
  const ph=document.getElementById("simphone");if(ph&&i!==6&&i!==7)ph.remove();
  const box=document.getElementById("simbox");
  box.innerHTML=`<div class="sh"><span class="k">${T.title} · ${i+1}/${T.s.length}</span>
      <button class="lnk" id="simLang">${T.lang}</button><button class="x" id="simX" aria-label="${T.close}">×</button></div>
    <div class="dots">${T.s.map((_,k)=>`<i class="${k<=i?"on":""}"></i>`).join("")}</div>
    <h3>${h}</h3><p>${body}</p>
    <div class="fd"><b>${T.feed}</b><ul id="simfeed"></ul></div>
    <div class="nav"><button class="btn" id="simPrev"${i?"":" disabled"}>${T.prev}</button>
      <button class="btn" id="simAuto">${SIM.auto?T.stop:T.auto}</button>
      <button class="btn primary" id="simNext">${i===T.s.length-1?T.done:T.next}</button></div>`;
  document.getElementById("simbanner").textContent=T.banner;
  document.getElementById("simPrev").onclick=()=>{SIM.auto=false;simShow(SIM.i-1)};
  document.getElementById("simNext").onclick=()=>{SIM.auto=false;simShow(SIM.i+1)};
  document.getElementById("simX").onclick=simEnd;
  document.getElementById("simLang").onclick=()=>{SIM.lang=SIM.lang==="is"?"en":"is";simShow(SIM.i)};
  document.getElementById("simAuto").onclick=()=>{SIM.auto=!SIM.auto;if(SIM.auto)simShow(SIM.i+1);else simShow(SIM.i)};
  if(back||i===0)SIM.feed=[];
  drawFeed();
  const E=T.ev;
  switch(i){
    case 0: setHour(NOW);selKey=SIM.prevSel;render();focusOn("#kpis");
      if(!SIM.feed.length){feed(E.start);feed(E.roads);feed(E.risk)}break;
    case 1: focusOn(".mapbox");setHour(NOW);animateTo(clamp(d.w.h,0,71),()=>feed(E.changed,"hook"));break;
    case 2: setHour(d.w.h);selKey=d.w.key;render();focusOn("#queue");break;
    case 3: selKey=d.w.key;render();focusOn("#brottfor");break;
    case 4: { selKey=d.w.key;render();const h3=[...document.querySelectorAll("#brottfor h3")].find(x=>/Myndavél/.test(x.textContent));focusOn(h3?h3.parentElement:"#brottfor");feed(E.roads);break }
    case 5: { selKey=d.w.key;render();const b=document.querySelector('#brottfor .decide');focusOn(b?b.parentElement:"#brottfor");
      const btn=b&&b.querySelector('[data-o="cancelled"]');if(btn){btn.classList.add("simpress")}
      feed(E.decided,"ok");feed(E.hook,"hook");feed(E.guides);break }
    case 6: focusOn("#brottfor");phone(d,T);feed(E.sms(d.pax),"ok");break;
    case 7: if(!document.getElementById("simphone"))phone(d,T);tally(d,T);break;
    case 8: focusOn("#kpis");feed(E.resolved,"hook");break;
    case 9: focusOn("#saga");feed(E.learn,"ok");break;
  }
  if(SIM.auto){const wait=i===1?Math.abs(d.w.h-NOW)*140+4000:i===7?5200:7000;SIM.timer=setTimeout(()=>SIM&&SIM.auto&&simShow(SIM.i+1),wait)}
}

(function simInit(){
  const bar=document.querySelector(".appbar .in"),badge=document.getElementById("badge");
  if(bar&&badge){const b=document.createElement("button");b.className="simbtn";b.id="simStart";b.type="button";
    b.innerHTML='<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 1.2v9.6L10.5 6z" fill="currentColor"/></svg>Hermun';
    b.title="Sýna hvernig dagur vaktstjóra lítur út (ekkert er sent)";b.onclick=simStart;bar.insertBefore(b,badge)}
  if(/[?&#]hermun\b|[?&]sim\b/.test(location.search+location.hash)){
    const wait=()=>DEPS.length&&document.querySelector("#queue .qrow")?simStart():setTimeout(wait,300);setTimeout(wait,500)}
})();
