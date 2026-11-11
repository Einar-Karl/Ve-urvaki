// Real map (Leaflet + Mapbox raster tiles, or another provider from settings). Layers: national wind grid (arrows coloured by gust),
// tours coloured by cancel risk for the scrubbed hour, and cameras that have a position.
// Falls back to the built-in SVG outline (views.js) when Leaflet is unavailable or the map is switched off.
let LMAP=null,LLAYERS=null,LTILE_ERR=false;const ISL_BOUNDS=[[63.25,-24.6],[66.6,-13.4]];
const gustColor=g=>g>=27?"var(--cancel)":g>=20?"var(--change)":"var(--faint)";

function mapEnabled(){return !!(window.L&&MAPCFG&&MAPCFG.tilesUrl&&!MAPCFG.disabled)}

function ensureLeaflet(){
  if(LMAP)return LMAP;
  const el=document.getElementById("lmap");
  LMAP=L.map(el,{zoomControl:true,attributionControl:true,minZoom:5,maxZoom:MAPCFG.maxZoom||12,maxBounds:[[61.5,-30],[68.5,-8]]});
  el.hidden=false;LMAP.invalidateSize();LMAP.fitBounds(ISL_BOUNDS);   // fit only once the container has a size
  const tl=L.tileLayer(MAPCFG.tilesUrl,{attribution:MAPCFG.attribution||"",maxZoom:MAPCFG.maxZoom||12,crossOrigin:true,...(MAPCFG.tileSize?{tileSize:MAPCFG.tileSize,zoomOffset:MAPCFG.zoomOffset||0}:{})});
  tl.on("tileerror",()=>{if(!LTILE_ERR){LTILE_ERR=true;const n=document.getElementById("maptiles");if(n)n.textContent="Kortaflísar hlaðast ekki (net eða flísaveita). Gögnin á kortinu eru samt rétt.";}});
  tl.addTo(LMAP);
  LLAYERS={wind:L.layerGroup().addTo(LMAP),tours:L.layerGroup().addTo(LMAP),cams:L.layerGroup().addTo(LMAP)};
  L.control.layers(null,{"Vindur":LLAYERS.wind,"Ferðir":LLAYERS.tours,"Myndavélar":LLAYERS.cams},{collapsed:true,position:"topright"}).addTo(LMAP);
  const leg=L.control({position:"bottomleft"});
  leg.onAdd=()=>{const d=L.DomUtil.create("div","maplegend");d.innerHTML='<b>Hviður</b><span><i style="background:var(--faint)"></i>&lt; 20 m/s</span><span><i style="background:var(--change)"></i>20–27</span><span><i style="background:var(--cancel)"></i>&gt; 27</span>';return d};
  leg.addTo(LMAP);
  return LMAP;
}

function arrowIcon(dirDeg,gust,speed){
  const len=12+Math.min(18,(speed||0)*0.9),ang=((dirDeg||0)+180)%360,col=gustColor(gust||0);
  return L.divIcon({className:"windarrow",iconSize:[34,34],iconAnchor:[17,17],
    html:`<svg viewBox="-17 -17 34 34" width="34" height="34" style="transform:rotate(${ang.toFixed(0)}deg)"><line y1="${len/2}" y2="${-len/2}" stroke="${col}" stroke-width="2"/><path d="M-4,${-len/2+5}L0,${-len/2}L4,${-len/2+5}" fill="none" stroke="${col}" stroke-width="2"/></svg>`});
}

function drawLeafletMap(){
  ensureLeaflet();
  const el=document.getElementById("lmap");if(el.hidden){el.hidden=false;LMAP.invalidateSize();LMAP.fitBounds(ISL_BOUNDS)}document.getElementById("map").style.display="none";
  LLAYERS.wind.clearLayers();LLAYERS.tours.clearLayers();LLAYERS.cams.clearLayers();
  // wind: real national grid when available, otherwise interpolated from the per-site forecasts (idw in views.js)
  if(GRID&&GRID.points&&GRID.points.length){
    const off=Math.round((START.getTime()-Date.parse(GRID.start))/3600e3),i=hour+off;
    GRID.points.forEach(pt=>{const g=pt.g[i],w=pt.w[i],d=pt.dir[i];if(g==null)return;
      L.marker([pt.lat,pt.lon],{icon:arrowIcon(d,g,w),interactive:false,keyboard:false}).addTo(LLAYERS.wind)});
  }else{
    for(let lon=-24.3;lon<=-13.6;lon+=1.05)for(let lat=63.45;lat<=66.5;lat+=.42){const I=idw(lon,lat,hour);
      L.marker([lat,lon],{icon:arrowIcon(I.dir,I.g,I.w),interactive:false,keyboard:false}).addTo(LLAYERS.wind)}
  }
  // tours: next departure at/after the scrubbed hour
  TOURS.forEach(t=>{const nx=DEPS.filter(d=>d.t.id===t.id&&d.h+t.dur>=hour).sort((a,b)=>a.h-b.h)[0];if(!nx)return;const R=risk(t,nx.h);
    const sel=selKey&&selKey.startsWith(t.id+"-");
    const icon=L.divIcon({className:"tourpin"+(sel?" sel":""),iconSize:[30,30],iconAnchor:[15,15],html:`<span style="background:${COL[R.status]}">${Math.round(R.cancel*100)}</span>`});
    const m=L.marker([t.ll[1],t.ll[0]],{icon,title:`${t.name}: ${STAT[R.status]}, ${pct(R.cancel)} líkur á aflýsingu`,keyboard:true,riseOnHover:true}).addTo(LLAYERS.tours);
    m.bindTooltip(`<b>${esc(t.name)}</b><br>${dayLbl(nx.h)} ${hhmm(nx.h)} · ${STAT[R.status]} · ${pct(R.cancel)}${R.road?"<br>Vegur lokaður":""}`,{direction:"top",offset:[0,-12]});
    m.on("click",()=>{selKey=nx.key;hour=clamp(nx.h,0,71);document.getElementById("hour").value=hour;render(true)});
  });
  // cameras with a position
  CAMERAS.filter(c=>Number.isFinite(c.lat)).forEach(c=>{
    const m=L.marker([c.lat,c.lon],{icon:L.divIcon({className:"campin",iconSize:[22,22],iconAnchor:[11,11],html:"◉"}),title:c.name}).addTo(LLAYERS.cams);
    if(c.type==="page")m.bindPopup(`<b>${esc(c.name)}</b><br><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Opna myndavél ↗</a>`);
    else m.bindPopup(()=>{const d=document.createElement("div");d.innerHTML=`<b>${esc(c.name)}</b><div class="campop">Sæki mynd…</div>`;
      fetch(`/api/cameras/${encodeURIComponent(c.id)}/snapshot`).then(r=>r.ok?r.blob():Promise.reject()).then(b=>{const img=new Image();img.src=URL.createObjectURL(b);img.alt=c.name;d.querySelector(".campop").replaceChildren(img)}).catch(()=>{d.querySelector(".campop").textContent="Myndavél ekki tiltæk"});return d},{maxWidth:320});
  });
}
