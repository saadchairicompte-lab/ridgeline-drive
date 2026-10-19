// Ridgeline Drive: Two players on one computer, each driving from their own phone, on a screen split top and bottom.
// Classic script: top-level declarations are shared with the other files, loaded in the order index.html lists them.
'use strict';
/* ================= second player =================
   Physics, cameras, lap timing and the HUD were written for one car held in globals (`car`, `lap`, `drift`,
   `camMode`, `camera`...). Rather than thread a player through every function, player 2's copy of that state
   lives in P2 and swapPlayer() trades it with the globals. Swapping twice puts everything back, so player 2's
   work is always wrapped: swapPlayer(); ...same code as player 1...; swapPlayer(). Outside those wraps the
   globals are always player 1's.
   Single player is untouched: P2.on stays false until a second phone takes seat 2 (controls.js pollWheels). */
function cloneState(o) {
  if (o instanceof V3 || o instanceof THREE.Quaternion) return o.clone();
  if (Array.isArray(o)) return o.map(cloneState);
  if (o && typeof o === 'object') { const r = {}; for (const k in o) r[k] = k === 'mark' ? null : cloneState(o[k]); return r; }
  return o;
}
const CAR_KEYS = Object.keys(car), LAP_KEYS = Object.keys(lap), DRIFT_KEYS = Object.keys(drift);
const P2 = {
  on: false,
  state: cloneState(car),
  lap: { armed: false, start: 0, half: false, lastProg: -1, best: null, last: null, now: 0 },
  drift: { cur: 0, timer: 0, total: 0 },
  cam: { pos: new V3(), q: new THREE.Quaternion(), fov: 60, mode: 0, yaw: 0, init: false, attract: 1.7, sunk: 0 }
};
const twoUp = () => P2.on;
const swapKeys = (a, b, keys) => { for (const k of keys) { const t = a[k]; a[k] = b[k]; b[k] = t; } };
// the physics globals derived from car.q follow the car that is swapped in
function carFrame() { qInv.copy(car.q).invert(); up.set(0, 1, 0).applyQuaternion(car.q); fwd.set(0, 0, 1).applyQuaternion(car.q); left.set(1, 0, 0).applyQuaternion(car.q); }
function swapCar() { swapKeys(car, P2.state, CAR_KEYS); carFrame(); }
const camTmp = new V3(), camTmpQ = new THREE.Quaternion();
function swapPlayer() {
  swapCar();
  swapKeys(lap, P2.lap, LAP_KEYS); swapKeys(drift, P2.drift, DRIFT_KEYS);
  const c = P2.cam;
  [camMode, c.mode] = [c.mode, camMode]; [camYaw, c.yaw] = [c.yaw, camYaw]; [camInit, c.init] = [c.init, camInit];
  [attractT, c.attract] = [c.attract, attractT]; [sunk, c.sunk] = [c.sunk, sunk];
  camTmp.copy(camera.position); camera.position.copy(c.pos); c.pos.copy(camTmp);
  camTmpQ.copy(camera.quaternion); camera.quaternion.copy(c.q); c.q.copy(camTmpQ);
  [camera.fov, c.fov] = [c.fov, camera.fov]; camera.updateProjectionMatrix();
}
// fn runs once as player 1, then (in two-player mode) once more as player 2
function eachPlayer(fn) {
  fn(0);
  if (!P2.on) return;
  swapPlayer(); try { fn(1); } finally { swapPlayer(); }
}
const otherCarPos = () => P2.on ? P2.state.pos : null;   // the car that isn't swapped in (minimap dot)

function setTwoPlayer(on) {
  if (P2.on === on) return;
  if (on) placeBeside();
  P2.on = on; carView2.root.visible = on;
  buildHud2(); document.body.classList.toggle('split', on);
  resize();
  if (!on) toast('Player 2 left');
}
// Player 2 starts parked 3.6 m to the left of player 1, facing the same way.
function placeBeside() {
  const s = P2.state, f = new V3(0, 0, 1).applyQuaternion(car.q), yaw = Math.atan2(f.x, f.z);
  s.pos.set(car.pos.x + Math.cos(yaw) * 3.6, 0, car.pos.z - Math.sin(yaw) * 3.6);
  s.pos.y = Math.max(H(s.pos.x, s.pos.z), WATER) + 0.9;
  s.q.setFromAxisAngle(new V3(0, 1, 0), yaw);
  s.vel.set(0, 0, 0); s.w.set(0, 0, 0); s.gear = 1; s.reverse = false; s.rpm = 900; s.shiftT = 0; s.tcsCut = 1;
  s.steer = s.thrIn = s.brkIn = s.hand = 0;
  s.wheels.forEach(w => { w.comp = 0; w.omega = 0; w.mark = null; });
  Object.assign(P2.lap, { armed: false, start: 0, half: false, lastProg: -1 });
  Object.assign(P2.cam, { init: false, yaw, mode: camMode });
}

/* Physics for both cars, one 120 Hz step, then a bump between them if they touch. */
function stepCars(dt) {
  if (P2.on) { swapCar(); physicsStep(dt); swapCar(); }
  physicsStep(dt);
  if (P2.on) carContact();
}
// Each car is three 1 m circles along its length (as for trees); the deepest overlapping pair pushes the cars
// apart and exchanges an impulse at the contact point, so a nudge also turns the car that was hit.
const CC_OFF = [1.35, 0, -1.35], CC_R = 1.0;
const ccFA = new V3(), ccFB = new V3(), ccN = new V3(), ccC = new V3(), ccRA = new V3(), ccRB = new V3(), ccV = new V3(), ccJ = new V3();
function carContact() {
  const A = car, B = P2.state;
  if (A.pos.distanceToSquared(B.pos) > 49 || Math.abs(A.pos.y - B.pos.y) > 2.5) return;
  ccFA.set(0, 0, 1).applyQuaternion(A.q); ccFB.set(0, 0, 1).applyQuaternion(B.q);
  let best = 0, ax = 0, az = 0, bx = 0, bz = 0;
  for (const oa of CC_OFF) for (const ob of CC_OFF) {
    const pax = A.pos.x + ccFA.x * oa, paz = A.pos.z + ccFA.z * oa, pbx = B.pos.x + ccFB.x * ob, pbz = B.pos.z + ccFB.z * ob;
    const depth = 2 * CC_R - Math.hypot(pax - pbx, paz - pbz);
    if (depth > best) { best = depth; ax = pax; az = paz; bx = pbx; bz = pbz; }
  }
  if (best <= 0) return;
  carFrame();
  ccN.set(ax - bx, 0, az - bz); if (ccN.lengthSq() < 1e-8) ccN.set(1, 0, 0); ccN.normalize();
  A.pos.addScaledVector(ccN, best * 0.5); B.pos.addScaledVector(ccN, -best * 0.5);
  ccC.set((ax + bx) / 2, (A.pos.y + B.pos.y) / 2, (az + bz) / 2);
  ccRA.subVectors(ccC, A.pos); ccRB.subVectors(ccC, B.pos);
  const vn = ccV.crossVectors(A.w, ccRA).add(A.vel).dot(ccN) - ccJ.crossVectors(B.w, ccRB).add(B.vel).dot(ccN);
  if (vn >= 0) return;
  const eA = effMass(ccRA, ccN);
  swapCar(); const eB = effMass(ccRB, ccN);
  const j = -1.3 * vn / (eA + eB), hit = Math.min(1, -vn / 8);
  applyImpulse(ccJ.copy(ccN).multiplyScalar(-j), ccRB); car.impact = Math.max(car.impact, hit);
  swapCar();
  applyImpulse(ccJ.copy(ccN).multiplyScalar(j), ccRA); car.impact = Math.max(car.impact, hit);
}

/* Player 2's HUD: copies of player 1's lap panel, minimap, gauge and drift counter for the bottom half, with
   every id suffixed "2". Their CSS is copied from index.html's rules the same way, then moved down. */
let hud2 = null;
const HUD_IDS = ['lap', 'map', 'dash', 'driftNow'];
const splitCss = `
body.split::after{content:'';position:fixed;left:0;right:0;top:50%;height:4px;margin-top:-2px;background:var(--ink);pointer-events:none}
body:not(.split) .p2,.ptag{display:none!important}
body.split .ptag{display:block!important;font-family:var(--display);font-weight:800;font-style:italic;font-size:16px;letter-spacing:.06em;text-transform:uppercase}
body.split #keys{display:none}
body.split #dash{bottom:calc(50% + 8px);transform:scale(.6);transform-origin:bottom right}
body.split #map{bottom:calc(50% + 12px);width:110px;height:110px}
body.split #driftNow{top:12%}
body.split #toast{top:calc(25% - 16px)}
body.split #lap2{top:calc(50% + 14px)}
body.split #dash2{bottom:calc(8px + env(safe-area-inset-bottom,0px));transform:scale(.6);transform-origin:bottom right}
body.split #map2{bottom:calc(12px + env(safe-area-inset-bottom,0px));width:110px;height:110px}
body.split #driftNow2{top:62%}
`;
function buildHud2() {
  if (hud2) return;
  const ids = new Set();
  for (const id of HUD_IDS) {
    const el = $(id), copy = el.cloneNode(true);
    for (const n of [copy, ...copy.querySelectorAll('[id]')]) { ids.add(n.id); n.id += '2'; }
    copy.classList.add('p2'); el.after(copy);
  }
  const re = new RegExp('#(' + [...ids].join('|') + ')(?![\\w-])', 'g');
  let css = '';
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch (e) { continue; }   // cross-origin (fonts)
    for (const r of rules) if (r.selectorText && r.selectorText.search(re) >= 0) css += r.cssText.replace(re, '#$12') + '\n';
  }
  document.head.insertAdjacentHTML('beforeend', '<style>' + css + splitCss + '</style>');
  const tag = (el, txt, col) => el.insertAdjacentHTML('afterbegin', '<div class="ptag" style="color:' + col + '">' + txt + '</div>');
  tag($('lap'), 'Player 1', '#' + new THREE.Color(PAINTS[0]).offsetHSL(0, 0, 0.12).getHexString());
  tag($('lap2'), 'Player 2', '#' + new THREE.Color(PAINTS[1]).offsetHSL(0, 0, 0.2).getHexString());
  hud2 = { abs: $('lampAbs2'), tcs: $('lampTcs2'), lap: $('lapTime2'), best: $('best2'), last: $('lastLap2'), dt: $('driftTotal2'), dn: $('driftNow2'),
    spd: $('spd2'), gear: $('gear2'), gctx: $('gauge2').getContext('2d'), mctx: $('map2').getContext('2d'), gauge: $('gauge2'), map: $('map2') };
}
