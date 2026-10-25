import * as maplibregl from './vendor/maplibre-gl.mjs';
import { CloudLayer } from './clouds.js';
import { localFrame } from './math.js';
import { windBearing } from './wind.js';
import { mountains, cities, peaks } from './places.js';

const $=id=>document.getElementById(id);
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const settings={coverage:58,altitude:2200,thickness:1200,wind:24,direction:270,sun:14,quality:'balanced',enabled:true,orbit:false};
let destination=mountains[0],paused=false;
const presets={
  drift:{name:'Alpine drift',coverage:58,altitude:2200,thickness:1200,wind:24,direction:270,sun:14},
  fog:{name:'Valley fog',coverage:83,altitude:1300,thickness:1400,wind:12,direction:315,sun:10},
  golden:{name:'Golden hour',coverage:64,altitude:2800,thickness:1300,wind:18,direction:225,sun:18}
};
let map,cloud,orbitFrame=0,lastOrbit=0,ready=false,failed=false;
function updateStatus() {
  if(!ready||failed)return;
  const globalView=map.getZoom()<7;
  $('status').textContent=!settings.enabled?'Clouds hidden':globalView?'Zoom in for volumetric clouds':paused?'Clouds paused':settings.wind===0?'Calm · 0 km/h':'Atmosphere in motion';
  if(globalView)$('fps').textContent='';
}

function mountCloudLayer() {
  if(map.getLayer('volumetric-clouds'))return;
  const previous=cloud;
  failed=false;
  const origin=maplibregl.MercatorCoordinate.fromLngLat(destination.center,0);
  cloud=new CloudLayer(origin,settings,result=>{
    if(result.error){failed=true;$('status').textContent='Cloud renderer unavailable';showError(`The cloud renderer could not start: ${result.error}. The terrain remains interactive.`);}
    else if(result.ready&&!failed){updateStatus();if(result.fps)$('fps').textContent=`${Math.min(240,Math.round(result.fps))} fps`;}
    $('map').dataset.renderer=result.error?'error':'ready';
  });
  cloud.windOffset=previous?.windOffset??[0,0];
  cloud.running=!paused;
  map.addLayer(cloud);
  if(cloud.ready)$('error').hidden=true;
  syncSun();map.triggerRepaint();
}

function showError(message) { $('error').hidden=false;$('error').textContent=message;$('loading').classList.add('loaded'); }
function updateControls() {
  for(const key of ['coverage','altitude','thickness','wind','direction','sun']) {
    const input=$(key);input.value=settings[key];
    const percent=(settings[key]-Number(input.min))/(Number(input.max)-Number(input.min))*100;
    input.style.setProperty('--progress',`${percent}%`);
    let value;
    if(key==='coverage')value=`${settings[key]}%`;
    else if(key==='wind')value=`${settings[key]} km/h`;
    else if(key==='direction')value=windBearing(settings.direction);
    else if(key==='sun'){const h=Math.floor(settings.sun),m=Math.round((settings.sun-h)*60);value=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;}
    else value=`${settings[key].toLocaleString('en-US')} m`;
    $(`${key}-value`).value=value;
    input.setAttribute('aria-valuetext',value);
  }
  $('layer-description').textContent=`Cloud layer · ${settings.altitude.toLocaleString('en-US')}–${(settings.altitude+settings.thickness).toLocaleString('en-US')} m`;
  $('quality').value=settings.quality;
  $('cloud-toggle').setAttribute('aria-checked',String(settings.enabled));
  updateStatus();
}
function syncSun() {
  if(!ready)return;
  map.setPaintProperty('relief','hillshade-illumination-direction',(settings.sun-6)/13*180+90);
  map.setPaintProperty('relief','hillshade-shadow-color',settings.sun>16?'#3b3347':'#243c49');
  map.setPaintProperty('satellite','raster-brightness-max',settings.sun>17?0.90:1);
  map.setPaintProperty('satellite','raster-saturation',settings.sun>17?-0.18:-0.3);
  const warm=Math.min(1,Math.max(0,(Math.abs(settings.sun-12)-2)/4.5));
  const mix=(a,b)=>Math.round(a+(b-a)*warm);
  map.setSky({'sky-color':`rgb(${mix(151,182)},${mix(190,169)},${mix(211,157)})`,'horizon-color':`rgb(${mix(204,233)},${mix(221,204)},${mix(224,173)})`,'fog-color':'#bdcccf','sky-horizon-blend':0.6,'horizon-fog-blend':0.6,'fog-ground-blend':0.55,'atmosphere-blend':0});
}
function presetSelection(id) {
  document.querySelectorAll('.preset').forEach(button=>{const selected=button.dataset.preset===id;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
}
function applyPreset(id) {
  const preset=presets[id];
  Object.assign(settings,preset,{enabled:true});
  settings.altitude+=destination.altitudeOffset??0;
  $('weather-name').textContent=preset.name;
  presetSelection(id);updateControls();syncSun();map?.triggerRepaint();
}
for(const key of ['coverage','altitude','thickness','wind','direction','sun']) $(key).addEventListener('input',event=>{
  settings[key]=Number(event.target.value);$('weather-name').textContent='Your atmosphere';
  presetSelection(null);updateControls();if(key==='sun')syncSun();if(cloud)cloud.last=0;map?.triggerRepaint();
});
document.querySelectorAll('.preset').forEach(button=>button.addEventListener('click',()=>applyPreset(button.dataset.preset)));
$('quality').addEventListener('change',event=>{settings.quality=event.target.value;map?.triggerRepaint();});
$('cloud-toggle').addEventListener('click',()=>{settings.enabled=!settings.enabled;updateControls();map?.triggerRepaint();});
function updatePlayback(nextPaused) {
  paused=nextPaused;
  if(cloud)cloud.running=!paused;
  $('pause').setAttribute('aria-pressed',String(paused));$('pause-icon').textContent=paused?'▷':'Ⅱ';$('pause-label').textContent=paused?'Resume clouds':'Pause clouds';
  if(cloud)cloud.last=0;
  updateStatus();
  map?.triggerRepaint();
}
$('pause').addEventListener('click',()=>updatePlayback($('pause').getAttribute('aria-pressed')!=='true'));
function orbit(now) {
  if(!settings.orbit||!map||document.hidden){lastOrbit=0;orbitFrame=0;return;}
  if(lastOrbit)map.setBearing(map.getBearing()+Math.min(0.1,(now-lastOrbit)/1000)*1.8);
  lastOrbit=now;orbitFrame=requestAnimationFrame(orbit);
}
function stopOrbit() {
  settings.orbit=false;$('orbit').setAttribute('aria-pressed','false');cancelAnimationFrame(orbitFrame);lastOrbit=0;orbitFrame=0;
}
$('orbit').addEventListener('click',()=>{
  if(settings.orbit)stopOrbit();else{settings.orbit=true;$('orbit').setAttribute('aria-pressed','true');orbitFrame=requestAnimationFrame(orbit);}
});
$('reset').addEventListener('click',()=>{stopOrbit();map?.easeTo({...destination.camera,duration:reduced.matches?0:1600});});
$('globe-view').addEventListener('click',()=>{stopOrbit();map?.easeTo({center:destination.center,zoom:1.5,pitch:0,bearing:0,duration:reduced.matches?0:1800});});

for(const mountain of mountains) {
  const option=document.createElement('option');option.value=mountain.id;option.textContent=mountain.name;$('mountain').append(option);
}
function updateDestination() {
  $('region').textContent=destination.region;
  $('landscape').textContent=destination.landscape;
  const [lng,lat]=destination.center;
  $('coordinates').textContent=`${lat.toFixed(4)}° N / ${lng.toFixed(4)}° E`;
  $('peak-name').textContent=destination.name.toUpperCase();
  $('map').setAttribute('aria-label',`Interactive 3D map around ${destination.name}`);
}
$('mountain').addEventListener('change',event=>{
  const previousOffset=destination.altitudeOffset??0;
  destination=mountains.find(mountain=>mountain.id===event.target.value);
  settings.altitude=Math.max(400,Math.min(11000,settings.altitude+(destination.altitudeOffset??0)-previousOffset));
  updateControls();
  updateDestination();stopOrbit();
  if(cloud)cloud.model=localFrame(maplibregl.MercatorCoordinate.fromLngLat(destination.center,0));
  map?.flyTo({...destination.camera,duration:reduced.matches?0:2400});
  updatePlaceLabels();
});
updateDestination();

const placeMarkers=[];
function updatePlaceLabels() {
  if(!map)return;
  updateStatus();
  const zoom=map.getZoom(),bounds=map.getBounds();
  const occupied=[],width=$('map').clientWidth,height=$('map').clientHeight;
  const prioritized=[...placeMarkers].sort((a,b)=>Number(b.place.id===destination.id)-Number(a.place.id===destination.id)||(a.type==='peak'?0:1)-(b.type==='peak'?0:1)||a.place.minZoom-b.place.minZoom);
  for(const {place,element,type} of prioritized) {
    const show=$(type==='peak'?'peak-names':'city-names').checked;
    let visible=show&&zoom>=place.minZoom&&bounds.contains(place.center);
    if(visible) {
      const point=map.project(place.center),w=place.name.length*6.4+20;
      const box={left:point.x-w/2,right:point.x+w/2,top:point.y-27,bottom:point.y+8};
      visible=point.x>=0&&point.x<=width&&point.y>=0&&point.y<=height&&!occupied.some(other=>box.left<other.right&&box.right>other.left&&box.top<other.bottom&&box.bottom>other.top);
      if(visible)occupied.push(box);
    }
    element.classList.toggle('is-hidden',!visible);
  }
}
function mountPlaceLabels() {
  for(const [type,places] of [['peak',peaks],['city',cities]])for(const place of places) {
    const element=document.createElement('div');element.className=`${type}-label is-hidden`;element.textContent=place.name;element.dataset.placeType=type;
    new maplibregl.Marker({element,anchor:'bottom',offset:[0,-4],opacityWhenCovered:0.25,subpixelPositioning:true}).setLngLat(place.center).addTo(map);
    placeMarkers.push({place,element,type});
  }
  map.on('move',updatePlaceLabels);map.on('resize',updatePlaceLabels);updatePlaceLabels();
}
for(const id of ['city-names','peak-names'])$(id).addEventListener('change',updatePlaceLabels);
$('about').addEventListener('click',()=>$('about-dialog').showModal());
document.querySelector('.dialog-close').addEventListener('click',()=>$('about-dialog').close());
$('about-dialog').addEventListener('click',event=>{if(event.target===$('about-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
$('mobile-controls').addEventListener('click',()=>{const open=$('mobile-controls').getAttribute('aria-expanded')!=='true';$('mobile-controls').setAttribute('aria-expanded',String(open));document.querySelector('.panel').classList.toggle('mobile-open',open);});
document.addEventListener('visibilitychange',()=>{
  if(cloud)cloud.last=0;
  if(!document.hidden){map?.triggerRepaint();if(settings.orbit&&!orbitFrame)orbitFrame=requestAnimationFrame(orbit);}
});
reduced.addEventListener('change',event=>{if(event.matches)stopOrbit();});
updateControls();

try {
  maplibregl.setWorkerCount(2);
  map=new maplibregl.Map({
    container:'map',...destination.camera,minZoom:0,maxZoom:15,maxPitch:85,
    canvasContextAttributes:{antialias:false,alpha:false,preserveDrawingBuffer:true},
    pixelRatio:Math.min(window.devicePixelRatio||1,1.5),
    attributionControl:false,
    // MapLibre's globe projection supports a zoom-dependent transition.
    // Finish flattening at regional scale, where meter-space clouds take over.
    style:{version:8,projection:{type:['interpolate',['linear'],['zoom'],5,'vertical-perspective',7,'mercator']},sources:{
      satellite:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:18,attribution:'Imagery © Esri, Maxar, Earthstar Geographics, GIS User Community'},
      elevation:{type:'raster-dem',tiles:['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],tileSize:512,encoding:'terrarium',maxzoom:12,attribution:'<a href="https://mapterhorn.com/attribution" target="_blank">© Mapterhorn</a>'}
    },layers:[
      {id:'background',type:'background',paint:{'background-color':'#a9c2c9'}},
      {id:'satellite',type:'raster',source:'satellite',paint:{'raster-saturation':-0.3,'raster-contrast':0.08,'raster-brightness-min':0.04,'raster-fade-duration':350}},
      {id:'relief',type:'hillshade',source:'elevation',paint:{'hillshade-exaggeration':0.26,'hillshade-shadow-color':'#243c49','hillshade-highlight-color':'#fff4db','hillshade-illumination-direction':210,'hillshade-illumination-anchor':'map'}}
    ],terrain:{source:'elevation',exaggeration:1.15}}
  });
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'top-right');
  map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
  map.addControl(new maplibregl.ScaleControl({maxWidth:85,unit:'metric'}),'bottom-left');
  map.on('dragstart',stopOrbit);map.on('rotatestart',event=>{if(event.originalEvent)stopOrbit();});
  map.on('error',event=>{
    console.warn('Map:',event.error?.message);
    if(event.error?.message?.includes('Failed to fetch')&&!ready)$('status').textContent='Waiting for terrain data…';
  });
  // MapLibre serializes and rebuilds its style on context restoration; custom
  // layers are not serialized. A restored style needs a newly added layer.
  map.on('style.load',()=>{if(ready)mountCloudLayer();});
  map.on('load',()=>{
    ready=true;
    mountCloudLayer();updatePlayback(paused);mountPlaceLabels();
    $('loading').classList.add('loaded');
    $('map').dataset.terrain='ready';
    const observer=new IntersectionObserver(([entry])=>{cloud.visible=entry.isIntersecting;cloud.last=0;if(cloud.visible)map.triggerRepaint();});
    observer.observe($('map'));
  });
  const timeout=setTimeout(()=>{
    if(!ready)showError('The map is taking longer to load. Check your internet connection; terrain and imagery are downloaded from Mapterhorn and Esri.');
  },25000);
  map.once('load',()=>clearTimeout(timeout));
  map.getCanvas().addEventListener('webglcontextlost',event=>{
    event.preventDefault();$('status').textContent='Graphics context interrupted';if(cloud){cloud.ready=false;cloud.last=0;}stopOrbit();
  });
} catch(error) {
  showError(`This demo needs WebGL 2 and hardware acceleration. ${error.message}`);$('status').textContent='WebGL 2 unavailable';
}
