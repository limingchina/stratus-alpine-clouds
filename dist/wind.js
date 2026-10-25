// Meteorological bearings: 0° is wind FROM north, 90° FROM east.
// Six-times cloud time makes the drift readable at mountain-map scale.
export const CLOUD_TIME_SCALE=6;
export function advanceWind(offset,speed,direction,seconds) {
  const radians=direction*Math.PI/180;
  const distance=Math.max(0,speed)/3.6*Math.max(0,seconds)*CLOUD_TIME_SCALE;
  return [offset[0]-Math.sin(radians)*distance,offset[1]-Math.cos(radians)*distance];
}
export function windBearing(degrees) {
  const bearing=((degrees%360)+360)%360;
  const compass=['N','NE','E','SE','S','SW','W','NW'][Math.round(bearing/45)%8];
  return `${compass} · ${bearing}°`;
}
