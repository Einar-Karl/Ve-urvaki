// Data loading: talks to the Veðurvaki server (/api/*). Everything degrades gracefully:
//   server + live sources → mode "live"; server without internet → mode "demo" (fixtures);
//   no server (index.html opened as a file) → mode "embedded" (synthetic model in model.js).
let LIVE=null;            // { regionId: [ {g,w,dir,p,c,t,s,sp} × 96 hours from START ] }
let HIST=null;            // history payload from /api/history
let OBS=null;             // latest station readings by region
let KP=null;              // NOAA Kp series
let ROADS=null;           // Vegagerðin situations by region
let HEALTH=null;          // connector status list
let FC_META={mode:"embedded",sources:[],generatedAt:null};

async function api(path,ms=20000){
  const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),ms);
  try{const r=await fetch(path,{signal:ctl.signal});if(!r.ok)throw new Error(path+" → "+r.status);return await r.json()}
  finally{clearTimeout(t)}
}

async function loadData(){
  try{
    const f=await api("/api/forecast");
    START=new Date(f.start);NOW=f.nowHour;LIVE=f.regions;FC_META=f;
    buildDeps();
  }catch(e){FC_META={mode:"embedded",sources:[],generatedAt:null}}
  // The rest is optional and must never block the first render.
  const opt=(p,set)=>api(p).then(set).catch(()=>{});
  await Promise.all([
    opt("/api/history",j=>{HIST=j}),
    opt("/api/observations",j=>{OBS=j.regions||null}),
    opt("/api/aurora",j=>{KP=j.series||null}),
    opt("/api/roads",j=>{ROADS=j.configured?j.byRegion:null}),
  ]);
  loadHealth();
}
async function loadHealth(force){
  try{HEALTH=await api("/api/health"+(force?"?force=1":""),30000)}catch(e){HEALTH=null}
  if(typeof drawConnections==="function")drawConnections();
}
