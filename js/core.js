// Ridgeline Drive: Shared helpers, noise, terrain height function and the road loop spline. H(x,z) is the one ground query everything uses.
// Classic script: top-level declarations are shared with the other files, loaded in the order index.html lists them.
'use strict';
const V3 = THREE.Vector3, TAU = Math.PI * 2;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const C = h => new THREE.Color(h).convertSRGBToLinear();
// Load a Blender model by name: from the packed base64 in js/assets-data.js when present, else from assets/.
function loadGLB(name, url, onLoad, onError) {
  if (!THREE.GLTFLoader) { onError && onError(); return; }
  const b64 = window.GLB_DATA && window.GLB_DATA[name];
  if (!b64) { new THREE.GLTFLoader().load(url, onLoad, undefined, onError); return; }
  const bin = atob(b64), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  new THREE.GLTFLoader().parse(buf.buffer, '', onLoad, onError);
}
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();


/* ================= noise ================= */
function makeRng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const perm = new Uint8Array(512);
{ const r = makeRng(1337), p = []; for (let i = 0; i < 256; i++) p.push(i); for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
function noise2(x, y) {
  const X = Math.floor(x), Y = Math.floor(y), xf = x - X, yf = y - Y, xi = X & 255, yi = Y & 255;
  const h00 = perm[xi + perm[yi]] & 7, h10 = perm[xi + 1 + perm[yi]] & 7, h01 = perm[xi + perm[yi + 1]] & 7, h11 = perm[xi + 1 + perm[yi + 1]] & 7;
  const n00 = GX[h00] * xf + GY[h00] * yf, n10 = GX[h10] * (xf - 1) + GY[h10] * yf;
  const n01 = GX[h01] * xf + GY[h01] * (yf - 1), n11 = GX[h11] * (xf - 1) + GY[h11] * (yf - 1);
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
  return a + (b - a) * v;
}
function fbm(x, y, o) { let a = 1, f = 1, s = 0, n = 0; for (let i = 0; i < o; i++) { s += a * noise2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; } return s / n; }
function ridged(x, y, o) { let a = 1, f = 1, s = 0, n = 0; for (let i = 0; i < o; i++) { const v = 1 - Math.abs(noise2(x * f + i * 17.3, y * f - i * 9.1)); s += a * v * v; n += a; a *= 0.5; f *= 2.1; } return s / n; }


/* ================= terrain height ================= */
const WATER = 0;
function terrainRaw(x, z) {
  const r = Math.sqrt(x * x + z * z);
  let h = fbm(x / 1100, z / 1100, 4) * 95;
  h += fbm(x / 300 + 31.7, z / 300 - 12.1, 4) * 34;
  h += noise2(x / 55, z / 55) * 2.2;
  const m = ss(1900, 3000, r);
  if (m > 0) h += m * ridged(x / 900, z / 900, 5) * 280;
  return h + 9;
}


/* ================= road loop ================= */
const ROAD_HALF = 6.5, ROAD_BLEND = 30, BLEND_MAX = 80, CELL = 40;
const road = (function () {
  const pts = [], NC = 18;
  for (let i = 0; i < NC; i++) {
    const a = i / NC * TAU, r = 1000 + fbm(Math.cos(a) * 1.1 + 7.3, Math.sin(a) * 1.1 - 3.1, 3) * 1100;
    pts.push(new V3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const N = Math.floor(curve.getLength() / 4);
  const sp = curve.getSpacedPoints(N); sp.pop();
  const xs = new Float32Array(N), zs = new Float32Array(N); let hs = new Float32Array(N);
  for (let i = 0; i < N; i++) { xs[i] = sp[i].x; zs[i] = sp[i].z; hs[i] = terrainRaw(xs[i], zs[i]); }
  for (let pass = 0; pass < 5; pass++) {
    const tmp = new Float32Array(N), W = 18;
    for (let i = 0; i < N; i++) { let s = 0; for (let k = -W; k <= W; k++) s += hs[(i + k + N) % N]; tmp[i] = s / (2 * W + 1); }
    hs = tmp;
    if (pass === 2) for (let i = 0; i < N; i++) hs[i] = Math.max(hs[i], WATER + 2.4);
  }
  const dist = new Float32Array(N + 1);
  for (let i = 1; i <= N; i++) { const a = i - 1, b = i % N; dist[i] = dist[i - 1] + Math.hypot(xs[b] - xs[a], zs[b] - zs[a]); }
  const grid = new Map(), R = ROAD_HALF + BLEND_MAX + 2;
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const x0 = Math.floor((Math.min(xs[i], xs[j]) - R) / CELL), x1 = Math.floor((Math.max(xs[i], xs[j]) + R) / CELL);
    const z0 = Math.floor((Math.min(zs[i], zs[j]) - R) / CELL), z1 = Math.floor((Math.max(zs[i], zs[j]) + R) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = (cx + 4096) * 8192 + (cz + 4096); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i);
    }
  }
  return { N, xs, zs, hs, dist, L: dist[N], grid };
})();
const RQ = { d: 1e9, h: 0, i: 0, t: 0 };
function roadQuery(x, z) {
  RQ.d = 1e9;
  const l = road.grid.get((Math.floor(x / CELL) + 4096) * 8192 + (Math.floor(z / CELL) + 4096));
  if (!l) return RQ;
  const { xs, zs, hs, N } = road; let best = 1e18;
  for (let n = 0; n < l.length; n++) {
    const i = l[n], j = (i + 1) % N, ax = xs[i], az = zs[i], bx = xs[j] - ax, bz = zs[j] - az;
    let t = ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz); t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - ax - bx * t, dz = z - az - bz * t, d2 = dx * dx + dz * dz;
    if (d2 < best) { best = d2; RQ.i = i; RQ.t = t; RQ.h = hs[i] + (hs[j] - hs[i]) * t; }
  }
  RQ.d = Math.sqrt(best);
  return RQ;
}
let lastRoadD = 1e9;
const PADS = [];
function H(x, z) {
  const raw = terrainRaw(x, z);
  roadQuery(x, z); lastRoadD = RQ.d;
  // embankments widen with the height difference so banks stay climbable (about 22 degrees)
  const bw = Math.min(BLEND_MAX, Math.max(ROAD_BLEND, Math.abs(raw - RQ.h) * 2.4));
  let h = RQ.d >= ROAD_HALF + bw ? raw : RQ.h + (raw - RQ.h) * ss(ROAD_HALF + 1.5, ROAD_HALF + bw, RQ.d);
  // flat building pads (world.js adds one under the garage)
  for (let i = 0; i < PADS.length; i++) {
    const p = PADS[i], d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r + p.f) h = p.h + (h - p.h) * ss(p.r, p.r + p.f, d);
  }
  return h;
}
function normalAt(x, z, out) {
  const e = 0.6;
  return out.set(H(x - e, z) - H(x + e, z), 2 * e, H(x, z - e) - H(x, z + e)).normalize();
}
