// Static prototype data: time axis, regions, tour types, tours, departures, map geometry.
const START=new Date(2026,9,5,0,0);const NOW=8;
const WD=["sun","mán","þri","mið","fim","fös","lau"];
const MON=["jan","feb","mar","apr","maí","jún","júl","ágú","sep","okt","nóv","des"];

// Regions: base wind, storm amplitude, storm centre hour, width, rain amp, wave base, temperature base, lat/lon
const REG={
 rvk:{n:"Höfuðborgarsvæði",ll:[-21.9,64.1],b:7,a:12,c:31,w:9,p:4.2,s:1.1,t:6},
 rnes:{n:"Reykjanes",ll:[-22.4,63.9],b:8,a:14,c:29,w:9,p:4.8,s:1.4,t:6},
 west:{n:"Snæfellsnes",ll:[-23.3,64.85],b:8,a:13,c:34,w:9,p:4.5,s:1.4,t:5},
 hl:{n:"Langjökull",ll:[-20.1,64.65],b:9,a:16,c:30,w:10,p:5.5,s:0,t:-3},
 south:{n:"Suðurland",ll:[-19.6,63.62],b:9,a:15,c:27,w:10,p:6.5,s:0,t:6},
 se:{n:"Suðausturland",ll:[-16.3,64.1],b:7,a:11,c:24,w:11,p:5.5,s:0,t:5},
 north:{n:"Norðurland",ll:[-17.3,65.8],b:4,a:9,c:52,w:12,p:2.2,s:.8,t:3},
};

// Tour types and the [start of risk, historic cancellation threshold] per weather factor
const TYPES={
 snow:{n:"Vélsleðar",f:{g:[16,27],p:[3,8]}},
 hike:{n:"Jöklaganga",f:{g:[17,28],p:[3,9]}},
 cave:{n:"Íshellir",f:{g:[18,29],p:[2.5,7],t:[4,9]}},
 snork:{n:"Yfirborðsköfun",f:{g:[14,24],p:[4,10]}},
 aurora:{n:"Norðurljós",f:{c:[55,92],g:[18,28]}},
 whale:{n:"Hvalaskoðun",f:{s:[1.8,3.2],g:[15,24]}},
 jeep:{n:"Ofurjeppi",f:{g:[19,31],p:[4,10]}},
 raft:{n:"Flúðasigling",f:{g:[16,27],p:[4,9]}},
 atv:{n:"Fjórhjól",f:{g:[17,28],p:[3,8]}},
};
const FL={g:["Vindhviður","m/s"],p:["Úrkoma","mm/klst"],c:["Skýjahula","%"],s:["Ölduhæð","m"],t:["Hiti (bráðnun)","°C"]};

const TOURS=[
 {id:1,name:"Vélsleðar á Langjökli",type:"snow",r:"hl",ll:[-20.2,64.6],dep:[10,13],dur:3,pax:[38,44,30],cap:48,price:39900},
 {id:2,name:"Jöklaganga · Sólheimajökull",type:"hike",r:"south",ll:[-19.35,63.53],dep:[9,13],dur:3,pax:[52,60,48],cap:64,price:16900},
 {id:3,name:"Íshellir · Breiðamerkurjökull",type:"cave",r:"se",ll:[-16.3,64.08],dep:[11],dur:4,pax:[46,50,40],cap:54,price:24900},
 {id:4,name:"Yfirborðsköfun í Silfru",type:"snork",r:"rvk",ll:[-21.12,64.26],dep:[9,13],dur:3,pax:[24,24,22],cap:24,price:21900},
 {id:5,name:"Norðurljós frá Reykjavík",type:"aurora",r:"rvk",ll:[-21.6,64.02],dep:[21],dur:4,pax:[96,110,120],cap:150,price:9900},
 {id:6,name:"Hvalaskoðun · Reykjavík",type:"whale",r:"rvk",ll:[-22.05,64.17],dep:[13],dur:3,pax:[70,80,64],cap:90,price:13900},
 {id:7,name:"Ofurjeppi í Þórsmörk",type:"jeep",r:"south",ll:[-19.5,63.7],dep:[8],dur:9,pax:[18,20,16],cap:24,price:34900},
 {id:8,name:"Flúðasigling í Hvítá",type:"raft",r:"south",ll:[-20.4,64.16],dep:[10],dur:4,pax:[20,0,14],cap:28,price:14900},
 {id:9,name:"Fjórhjól á Reykjanesi",type:"atv",r:"rnes",ll:[-22.35,63.87],dep:[12],dur:2,pax:[16,18,14],cap:20,price:22900},
 {id:10,name:"Snæfellsjökull · jöklaganga",type:"hike",r:"west",ll:[-23.75,64.8],dep:[10],dur:5,pax:[14,12,12],cap:16,price:27900},
 {id:11,name:"Hvalaskoðun · Húsavík",type:"whale",r:"north",ll:[-17.34,66.05],dep:[10],dur:3,pax:[40,44,36],cap:60,price:14900},
 {id:12,name:"Norðurljós við Mývatn",type:"aurora",r:"north",ll:[-17.0,65.62],dep:[21],dur:3,pax:[28,30,34],cap:40,price:12900},
];

// Departures list (one entry per tour, day and departure time from NOW onwards)
const DEPS=[];
TOURS.forEach(t=>[0,1,2].forEach(d=>{if(!t.pax[d])return;t.dep.forEach((hh,i)=>{const h=d*24+hh;if(h<NOW-1)return;
  const pax=Math.round(t.pax[d]/t.dep.length*(i?0.85:1.15));DEPS.push({key:`${t.id}-${h}`,t,h,pax})})}));

// Map geometry
const COAST=[[-22.7,63.82],[-22.35,63.8],[-22.0,63.85],[-21.4,63.83],[-21.0,63.86],[-20.6,63.72],[-20.2,63.56],[-19.6,63.45],[-19.0,63.4],[-18.5,63.42],[-18.0,63.48],[-17.5,63.62],[-17.0,63.76],[-16.5,63.87],[-16.0,64.02],[-15.5,64.15],[-15.0,64.26],[-14.6,64.37],[-14.4,64.42],[-14.1,64.62],[-13.7,64.8],[-13.55,65.0],[-13.5,65.1],[-13.65,65.3],[-13.7,65.5],[-14.2,65.6],[-14.6,65.75],[-14.75,65.95],[-14.9,66.12],[-15.2,66.22],[-15.6,66.3],[-16.0,66.5],[-16.5,66.55],[-16.9,66.2],[-17.5,66.12],[-17.9,66.08],[-18.3,66.2],[-18.7,66.15],[-19.0,66.08],[-19.4,65.9],[-19.6,65.78],[-20.0,65.95],[-20.4,65.92],[-20.6,65.75],[-20.9,65.6],[-21.3,65.85],[-21.6,66.08],[-22.0,66.3],[-22.4,66.45],[-22.9,66.42],[-23.3,66.2],[-23.7,66.0],[-24.0,65.62],[-23.7,65.48],[-23.4,65.42],[-24.1,65.45],[-24.4,65.5],[-23.6,65.25],[-22.5,65.05],[-23.2,64.95],[-23.9,64.9],[-23.5,64.75],[-22.4,64.8],[-22.0,64.55],[-21.9,64.42],[-21.95,64.25],[-22.05,64.1],[-22.4,64.0],[-22.7,63.92]];
const GLAC=[{c:[-16.75,64.42],rx:48,ry:30,n:"Vatnajökull"},{c:[-20.1,64.62],rx:14,ry:13,n:"Langjökull"},{c:[-18.85,64.83],rx:12,ry:10,n:"Hofsjökull"},{c:[-19.1,63.66],rx:13,ry:7,n:"Mýrdalsjökull"},{c:[-23.78,64.8],rx:4,ry:3.5,n:""}];
const PLACES=[["Reykjavík",-21.94,64.14],["Akureyri",-18.09,65.68],["Vík",-19.0,63.42],["Höfn",-15.2,64.25]];
