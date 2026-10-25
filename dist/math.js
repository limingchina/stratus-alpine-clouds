// Column-major matrices. Keep CPU work in Float64: Mercator world coordinates
// are large compared with the few meters that distinguish two mountain slopes.
export function multiply(a, b) {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  }
  return out;
}
export function inverse(m) {
  const a = Array.from({ length: 4 }, (_, r) => Array.from({ length: 8 }, (_, c) => c < 4 ? m[c * 4 + r] : +(c - 4 === r)));
  for (let c = 0; c < 4; c++) {
    let pivot = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (Math.abs(a[pivot][c]) < 1e-16) throw new Error('Camera matrix is singular');
    [a[pivot], a[c]] = [a[c], a[pivot]];
    const divisor = a[c][c];
    for (let j = 0; j < 8; j++) a[c][j] /= divisor;
    for (let r = 0; r < 4; r++) if (r !== c) {
      const factor = a[r][c];
      for (let j = 0; j < 8; j++) a[r][j] -= factor * a[c][j];
    }
  }
  return new Float64Array(Array.from({ length: 16 }, (_, i) => a[i % 4][4 + Math.floor(i / 4)]));
}
export function localFrame(origin) {
  const s = origin.meterInMercatorCoordinateUnits();
  return new Float64Array([s, 0, 0, 0, 0, -s, 0, 0, 0, 0, s, 0, origin.x, origin.y, origin.z, 1]);
}
