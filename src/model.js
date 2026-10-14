// Formatting helpers and the (synthetic) weather and risk model.
const hDate=h=>new Date(START.getTime()+h*3600e3);
const hhmm=h=>String(((h%24)+24)%24).padStart(2,"0")+":00";
const dayLbl=h=>{const d=hDate(h);return `${WD[d.getUTCDay()]} ${d.getUTCDate()}. ${MON[d.getUTCMonth()]}`};
const fmtISK=n=>Math.round(n).toLocaleString("de-DE")+" kr.";
const fmtM=n=>(n/1e6).toLocaleString("de-DE",{minimumFractionDigits:1,maximumFractionDigits:1})+" m.kr.";
const pct=x=>Math.round(x*100)+"%";
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const gauss=(h,c,w)=>Math.exp(-(((h-c)/w)**2));

// Forecast for region r at hour h. Uses live/demo-fixture data from the API when loaded (see live.js),
// otherwise the built-in synthetic model so index.html still works when opened as a plain file.
function wx(r,h){
  if(LIVE&&LIVE[r]){const a=LIVE[r],x=a[clamp(h,0,a.length-1)];
    return {w:x.w,g:x.g,p:x.p,c:x.c,s:x.s||0,t:x.t,dir:x.dir,sp:x.sp||0};}
  return wxSynthetic(r,h);}
function wxSynthetic(r,h){const R=REG[r];const s=gauss(h,R.c,R.w);const diurnal=Math.sin((h%24-9)/24*2*Math.PI);
  const w=R.b+R.a*s+1.2*diurnal;const g=w*1.55+1.5*s;
  const p=Math.max(0,R.p*gauss(h,R.c-2,R.w*.8)+.2+.3*Math.sin(h*.7+R.b));
  const c=clamp(35+60*gauss(h,R.c,R.w*1.4)+15*Math.sin(h*.35+R.b),5,100);
  const sw=R.s?R.s+2.6*gauss(h,R.c+4,R.w*1.3):0;
  const t=R.t+1.5*s+2*diurnal;
  const dir=(140+90*clamp((h-R.c)/R.w,-1,1.4)+360)%360;
  return {w:+w.toFixed(1),g:+g.toFixed(1),p:+p.toFixed(1),c:Math.round(c),s:+sw.toFixed(1),t:+t.toFixed(1),dir};}

// A tour is forecast at its own meeting point when the server provides it ("tour:<id>"), else at its region.
const siteOf=t=>LIVE&&LIVE["tour:"+t.id]?"tour:"+t.id:t.r;
// Risk factors for a tour, in priority order: learned from decisions (t.f) > manual limits from
// config/tours.json (t.f0) > the tour type's defaults.
const tourF=t=>t.f||t.f0||TYPES[t.type].f;
const capOf=d=>d.cap||d.t.cap;

function risk(t,h,dur){dur=dur||t.dur;const f=tourF(t);const parts=[];
  for(const k in f){const [lo,hi]=f[k];let v=-1e9;for(let i=0;i<=dur;i++){const x=wx(siteOf(t),h+i)[k];if(x>v)v=x}
    parts.push({k,v:+v.toFixed(1),lo,hi,r:clamp((v-lo)/(hi-lo),0,1)});}
  let surv=1;parts.forEach(p=>surv*=1-p.r*.93);let cancel=clamp(1-surv,.02,.97);
  // lead-time uncertainty pulls toward middle
  // plus model disagreement: wider when the forecast sources differ on gusts
  let sp=0;for(let i=0;i<=dur;i++)sp=Math.max(sp,wx(siteOf(t),h+i).sp||0);
  const lead=Math.max(0,h-NOW);const unc=clamp(.04+lead*.0045+sp*.012,.04,.35);
  cancel=cancel*(1-unc*.35)+.5*unc*.35;
  let change=cancel<.2?cancel*1.2+.03:cancel<.55?.32:cancel<.75?.2:.1;
  let go=Math.max(.01,1-cancel-change);const s=go+change+cancel;
  const out={go:go/s,change:change/s,cancel:cancel/s,unc,parts:parts.sort((a,b)=>b.r-a.r)};
  // A closed/impassable access road (Vegagerðin) overrides the weather for the next 24 h.
  const rb=ROADS&&ROADS.blocked&&ROADS.blocked[t.id];
  if(rb&&h<NOW+24){out.road=rb;out.cancel=Math.max(out.cancel,.9);out.go=Math.min(out.go,.05);out.change=Math.min(out.change,.05)}
  out.status=out.cancel>=.5?"cancel":(out.cancel>=.2||out.change>=.3?"change":"go");return out;}

const STAT={go:"Fer fram",change:"Breyting líkleg",cancel:"Aflýsing líkleg"};
const COL={go:"var(--go)",change:"var(--change)",cancel:"var(--cancel)"};
// Decision 6 h before departure, or 18:00 the evening before for morning departures
const deadline=h=>h-((h%24)>=12?6:(h%24)+6);

const D=()=>DEPS.map(x=>({...x,R:risk(x.t,x.h)}));

// Inverse-distance weighted wind field between the regional forecasts
function idw(lon,lat,h){let sw=0,acc={w:0,g:0,dir_x:0,dir_y:0};for(const r in REG){const [x,y]=REG[r].ll;const d=Math.hypot((lon-x)*.45,lat-y)+.05;const wgt=1/(d*d);const W=wx(r,h);
  sw+=wgt;acc.w+=W.w*wgt;acc.g+=W.g*wgt;acc.dir_x+=Math.cos(W.dir*Math.PI/180)*wgt;acc.dir_y+=Math.sin(W.dir*Math.PI/180)*wgt}
  return {w:acc.w/sw,g:acc.g/sw,dir:Math.atan2(acc.dir_y,acc.dir_x)*180/Math.PI}}
