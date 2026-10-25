import test from 'node:test';
import assert from 'node:assert/strict';
import {multiply,inverse,localFrame} from '../dist/math.js';

test('local Mercator frame preserves altitude in meters and points north',()=>{
  const frame=localFrame({x:0.52,y:0.36,z:0,meterInMercatorCoordinateUnits:()=>3.6e-8});
  assert.equal(frame[0],3.6e-8);assert.equal(frame[5],-3.6e-8);assert.equal(frame[10],3.6e-8);
  assert.equal(frame[12],0.52);assert.equal(frame[13],0.36);
});
test('camera matrix inversion round-trips a terrain-scale projection',()=>{
  const model=localFrame({x:0.52,y:0.36,z:0,meterInMercatorCoordinateUnits:()=>3.6e-8});
  const projection=new Float64Array([310000,0,0,0,0,-210000,-80000,-80000,0,140000,-190000,-190000,-161000,75600,28801,28804]);
  const m=multiply(projection,model),product=multiply(m,inverse(m));
  for(let i=0;i<16;i++)assert.ok(Math.abs(product[i]-+(i%5===0))<1e-8,`matrix element ${i}`);
});
test('singular matrices are rejected instead of creating invalid cloud rays',()=>{
  assert.throws(()=>inverse(new Float64Array(16)),/singular/);
});
