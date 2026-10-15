// Data loading: talks to the Veðurvaki server (/api/*). Everything degrades gracefully:
//   server + live sources → mode "live"; server without internet → mode "demo" (fixtures);
//   no server (index.html opened as a file) → mode "embedded" (synthetic model in model.js).
let LIVE=null;            // { siteId: [ {g,w,dir,p,c,t,s,sp} × 96 hours from START ] } (regions and "tour:<id>")
let HIST=null;            // history payload from /api/history
let OBS=null;             // latest station readings by site
let KP=null;              // NOAA Kp series
let ROADS=null;           // /api/roads: { byTour, blocked } from Vegagerðin
let HEALTH=null;          // connector status list
let MODEL=null;           // learned thresholds from /api/model
let CAMERAS=[];           // /api/cameras: image cameras (relayed) and link-out pages
let TOUR_WARNINGS=[];     // problems found in config/tours.json
let TOURS_DEMO=true;      // config/tours.json still has "demo": true (example tours)
const DECISIONS={};       // "tourId|departureISO" → last recorded outcome
let FC_META={mode:"embedded",sources:[],generatedAt:null};

async function api(path,ms=20000){
  const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),ms);
  try{const r=await fetch(path,{signal:ctl.signal});if(!r.ok)throw new Error(path+" → "+r.status);return await r.json()}
  finally{clearTimeout(t)}
}
const depIso=d=>new Date(START.getTime()+d.h*3600e3).toISOString();

// config/tours.json → TOURS (same shape the rest of the front end already uses)
function applyTours(j){
  const mapped=j.tours.filter(t=>TYPES[t.type]).map(t=>({
    id:t.id,name:t.name,type:t.type,r:REG[t.region]?t.region:"rvk",ll:[t.lon,t.lat],
    dep:(t.departures||[]).map(x=>parseInt(x,10)),dur:t.durationHours||3,cap:t.capacity||0,price:t.priceISK||0,
    f0:t.limits?{...TYPES[t.type].f,...t.limits}:undefined,
    pax:DEFAULT_PAX[t.id]||[0.7,0.75,0.6].map(f=>Math.round((t.capacity||0)*f))}));
  if(!mapped.length)return;
  TOURS.length=0;TOURS.push(...mapped);
  TOUR_WARNINGS=[...(j.warnings||[])];TOURS_DEMO=j.demo!==false;
}
function applyModel(){
  TOURS.forEach(t=>{delete t.f;const m=MODEL&&MODEL.tours&&MODEL.tours[t.id];
    if(m&&m.status==="learned")t.f={...(t.f0||TYPES[t.type].f),g:m.g}});
}

async function loadData(){
  const opt=(p,set)=>api(p).then(set).catch(()=>{});
  await opt("/api/tours",applyTours);
  try{
    const f=await api("/api/forecast");
    START=new Date(f.start);NOW=f.nowHour;LIVE=f.regions;FC_META=f;
  }catch(e){FC_META={mode:"embedded",sources:[],generatedAt:null}}
  // The rest is optional and must never block the first render.
  await Promise.all([
    opt("/api/bookings",j=>{BOOKINGS=j}),
    opt("/api/model",j=>{MODEL=j}),
    opt("/api/cameras",j=>{CAMERAS=j}),
    opt("/api/history",j=>{HIST=j}),
    opt("/api/observations",j=>{OBS=j.regions||null}),
    opt("/api/aurora",j=>{KP=j.series||null}),
    opt("/api/roads",j=>{ROADS=j.configured?j:null}),
    opt("/api/ingest/outcomes?limit=2000",rows=>rows.forEach(r=>{DECISIONS[r.tourId+"|"+new Date(r.departure).toISOString()]=r})),
  ]);
  applyModel();
  buildDeps();
  loadHealth();
}
async function loadHealth(force){
  try{HEALTH=await api("/api/health"+(force?"?force=1":""),30000)}catch(e){HEALTH=null}
  if(typeof drawConnections==="function")drawConnections();
}

// Save a duty manager's decision together with the forecast that was on screen (the training label).
async function recordOutcome(d,outcome){
  const who=($("who")||{}).value||"";try{localStorage.setItem("vv-who",who)}catch(e){}
  const part=k=>{const p=d.R.parts.find(p=>p.k===k);return p?p.v:null};
  const rec={tourId:d.t.id,departure:depIso(d),outcome,decidedBy:who||null,decidedAt:new Date().toISOString(),mode:FC_META.mode,
    snapshot:{g:part("g"),p:part("p"),c:part("c"),s:part("s"),cancelProb:Math.round(d.R.cancel*1000)/1000,leadHours:d.h-NOW,forecastGeneratedAt:FC_META.generatedAt}};
  try{
    const r=await fetch("/api/ingest/outcomes",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(rec)});
    if(!r.ok)throw new Error("HTTP "+r.status);
    DECISIONS[d.t.id+"|"+rec.departure]=rec;
  }catch(e){alert("Tókst ekki að skrá ákvörðun: "+e.message)}
  drawDetail(D());
}
