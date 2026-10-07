// App state, top-level render and event wiring.
let hour=10,selKey=null;const done=new Set();let lang="en";

const setTime=()=>{document.getElementById("tm").textContent=`${dayLbl(hour)} · ${hhmm(hour)}`};

function render(keepScroll){
  setTime();
  const all=D();drawStatus();drawTop(all);drawMap();drawQueue(all);drawMatrix();drawDetail(all);drawHistory();
}

document.getElementById("hour").oninput=e=>{hour=+e.target.value;setTime();drawMap()};
let timer=null;
document.getElementById("play").onclick=e=>{
  const btn=e.currentTarget;
  if(timer){clearInterval(timer);timer=null;btn.classList.remove("on");return}
  btn.classList.add("on");
  timer=setInterval(()=>{hour=(hour+1)%72;document.getElementById("hour").value=hour;setTime();drawMap()},350)};

$("reCheck").onclick=()=>{$("reCheck").disabled=true;loadHealth(true).finally(()=>{$("reCheck").disabled=false})};

(async function init(){
  await loadData();
  hour=clamp(NOW+2,0,71);document.getElementById("hour").value=hour;
  render();drawConnections();
})();
