import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceWind,windBearing} from '../dist/wind.js';

const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} ≈ ${expected}`);
test('meteorological wind moves clouds downwind at six-times map time',()=>{
  for(const [direction,east,north] of [[0,0,-60],[90,-60,0],[180,0,60],[270,60,0]]) {
    const offset=advanceWind([0,0],36,direction,1);
    near(offset[0],east);near(offset[1],north);
  }
});
test('calm freezes existing displacement and changing wind never teleports clouds',()=>{
  const drift=advanceWind([0,0],36,270,100);
  assert.deepEqual(advanceWind(drift,0,90,120),drift);
  assert.deepEqual(advanceWind(drift,90,0,0),drift);
  const reversed=advanceWind(drift,36,90,1);
  near(reversed[0],drift[0]-60);near(reversed[1],drift[1]);
});
test('wind displacement is independent of frame rate',()=>{
  let manyFrames=[0,0];
  for(let frame=0;frame<600;frame++)manyFrames=advanceWind(manyFrames,24,315,1/60);
  const oneInterval=advanceWind([0,0],24,315,10);
  near(manyFrames[0],oneInterval[0]);near(manyFrames[1],oneInterval[1]);
});
test('compass labels normalize north at the slider endpoints',()=>{
  assert.equal(windBearing(0),'N · 0°');assert.equal(windBearing(360),'N · 0°');
  assert.equal(windBearing(270),'W · 270°');assert.equal(windBearing(315),'NW · 315°');
});
