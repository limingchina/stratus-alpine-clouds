import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {CloudLayer} from '../dist/clouds.js';
import {localFrame} from '../dist/math.js';
import {windBearing} from '../dist/wind.js';
import {mountains,cities} from '../dist/places.js';

// Exercise the real app event handlers with a small DOM/MapLibre adapter.
// This verifies interaction wiring without pretending to verify browser pixels.
function app() {
  const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  const elements=new Map(),markers=[];
  class Element {
    constructor(){this.events={};this.attrs={};this.children=[];this.dataset={};this.value='';this.style={setProperty(){}};this.clientWidth=1200;this.clientHeight=900;this.classes=new Set();this.classList={add:v=>this.classes.add(v),toggle:(v,on)=>on?this.classes.add(v):this.classes.delete(v)};}
    addEventListener(name,callback){this.events[name]=callback;}
    setAttribute(name,value){this.attrs[name]=value;}
    getAttribute(name){return this.attrs[name];}
    append(child){this.children.push(child);}
    fire(name,value){if(value!==undefined)this.value=value;this.events[name]?.({target:this});}
  }
  for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const element=new Element();
    for(const attr of ['min','max','value'])element[attr]=match[0].match(new RegExp(`\\b${attr}="([^"]+)"`))?.[1]??'';
    element.checked=/\bchecked\b/.test(match[0]);elements.set(match[1],element);
  }
  const presets=['drift','fog','golden'].map(preset=>Object.assign(new Element(),{dataset:{preset}}));
  const panel=new Element(),close=new Element();
  const document={hidden:false,getElementById:id=>{assert.ok(elements.has(id),`missing #${id}`);return elements.get(id);},createElement:()=>new Element(),querySelectorAll:()=>presets,querySelector:s=>s==='.panel'?panel:close,addEventListener(){}};
  class FakeMap {
    constructor(options){this.options=options;this.events={};this.layers=new Map();FakeMap.instance=this;}
    on(name,callback){(this.events[name]??=[]).push(callback);}
    once(name,callback){this.on(name,callback);}
    fire(name){for(const callback of this.events[name]??[])callback({});}
    getLayer(id){return this.layers.get(id);}
    addLayer(layer){this.layers.set(layer.id,layer);layer.ready=true;layer.onStatus({ready:true});}
    addControl(){} triggerRepaint(){} setPaintProperty(){} setSky(){}
    getCanvas(){return new Element();}
    flyTo(camera){this.camera=camera;}
    easeTo(camera){this.camera=camera;}
    getZoom(){return this.camera?.zoom??this.options.zoom;}
    getBounds(){return {contains:()=>true};}
    project(point){return {x:(point[0]*29)%1100+30,y:(point[1]*31)%800+30};}
  }
  class Marker {
    constructor(options){this.options=options;markers.push(this);}
    setLngLat(center){this.center=center;return this;}
    addTo(){return this;}
  }
  const maplibregl={Map:FakeMap,Marker,setWorkerCount(){},MercatorCoordinate:{fromLngLat:([lng,lat])=>({x:lng/360+0.5,y:0.5-lat/180,z:0,meterInMercatorCoordinateUnits:()=>3.6e-8})},NavigationControl:class{},AttributionControl:class{},ScaleControl:class{}};
  const code=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInNewContext(code,{document,maplibregl,CloudLayer,localFrame,windBearing,mountains,cities,matchMedia:()=>({matches:true,addEventListener(){}}),window:{devicePixelRatio:1},IntersectionObserver:class{observe(){}},setTimeout:()=>1,clearTimeout(){},cancelAnimationFrame(){},requestAnimationFrame:()=>1,console});
  const map=FakeMap.instance;map.fire('load');
  return {elements,map,markers,presets,cloud:()=>map.layers.get('volumetric-clouds')};
}

test('nonzero wind starts automatically even with reduced-motion preference',()=>{
  const {elements,cloud}=app();
  assert.equal(cloud().running,true);assert.equal(cloud().settings.wind,24);
  assert.equal(elements.get('pause').getAttribute('aria-pressed'),'false');
  elements.get('pause').fire('click');assert.equal(cloud().running,false);
  elements.get('direction').fire('input','90');assert.equal(cloud().settings.direction,90);
  assert.equal(cloud().running,false,'wind controls preserve an explicit pause');
  elements.get('pause').fire('click');assert.equal(cloud().running,true);
  elements.get('wind').fire('input','0');assert.equal(elements.get('status').textContent,'Calm · 0 km/h');
});
test('all mountain cameras, high-altitude weather, and reset remain connected',()=>{
  const {elements,map,cloud,presets}=app();
  assert.equal(elements.get('mountain').children.length,7);
  assert.equal(map.options.minZoom,2);
  for(const destination of mountains) {
    elements.get('mountain').fire('change',destination.id);
    assert.deepEqual(map.camera.center,destination.camera.center);
    assert.equal(elements.get('landscape').textContent,destination.landscape);
    elements.get('reset').fire('click');assert.deepEqual(map.camera.center,destination.camera.center);
  }
  assert.equal(cloud().settings.altitude,6700);
  presets[1].fire('click');assert.equal(cloud().settings.altitude,5800);
  elements.get('mountain').fire('change','matterhorn');assert.equal(cloud().settings.altitude,1300);
});
test('city labels mount by default and can be hidden; style recovery retains playback',()=>{
  const {elements,map,markers,cloud}=app();
  assert.equal(markers.length,cities.length);assert.ok(markers.some(marker=>marker.options.element.textContent==='Namche Bazaar'));
  elements.get('city-names').checked=false;elements.get('city-names').fire('change');
  assert.ok(markers.every(marker=>marker.options.element.classes.has('is-hidden')));
  cloud().windOffset=[420,-160];elements.get('pause').fire('click');map.layers.clear();map.fire('style.load');
  assert.deepEqual(cloud().windOffset,[420,-160]);assert.equal(cloud().running,false);
});
