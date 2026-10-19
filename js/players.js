// Ridgeline Drive: Two players on one computer (split screen, one phone each), race mode, and driving help for everyone: auto-recovery, wrong-way warning, join hint.
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

/* ================= race mode =================
   G on the keyboard or Race on either phone puts every car on a grid just before the chequered gantry, counts
   down 3-2-1 and runs a RACE_LAPS race. Progress is laps plus position along the road loop; a lap only counts
   after passing the half-way point, so turning round at the line doesn't add laps. One player = time trial. */
const RACE_LAPS = 3;
const newRP = () => ({ laps: -1, prog: 0.99, last: -1, half: false, done: null, total: -0.01 });
const race = { ph: 'idle', t: 0, t0: 0, p: [newRP(), newRP()] };
const ORD = ['1st', '2nd'];
function startRace() {
  if (!started) return;
  const i = road.N - 10, side = P2.on ? 2.4 : 0;
  eachPlayer(k => {
    placeOnRoad(i);
    car.pos.addScaledVector(left.set(1, 0, 0).applyQuaternion(car.q), k ? side : -side);
    car.pos.y = Math.max(H(car.pos.x, car.pos.z), WATER) + 0.9;
    car.steer = car.thrIn = car.brkIn = 0; lap.armed = false; drift.cur = 0; camInit = false;
  });
  race.ph = 'countdown'; race.t = 3.5; race.p = [newRP(), newRP()];
  for (const r of rec) r.flip = r.stuck = r.wrong = 0;
}
function trackProgress(i) {
  const r = race.p[i]; if (r.done != null) return;
  roadQuery(car.pos.x, car.pos.z); if (RQ.d > 40) return;   // far off the road: keep the last reading
  const prog = (RQ.i + RQ.t) / road.N;
  if (r.last >= 0) {
    if (r.last > 0.9 && prog < 0.1) { if (r.laps < 0 || r.half) { r.laps++; r.half = false; if (r.laps > 0 && r.laps < RACE_LAPS) banner(i, r.laps === RACE_LAPS - 1 ? 'Final lap' : 'Lap ' + (r.laps + 1), 1.6); } }
    else if (r.last < 0.1 && prog > 0.9 && r.laps >= 0) { r.laps--; r.half = true; }
    if (prog > 0.45 && prog < 0.55) r.half = true;
  }
  r.last = prog; r.total = r.laps + prog;
  if (r.laps >= RACE_LAPS) { r.done = clock - race.t0; r.total = RACE_LAPS + 1; banner(i, P2.on ? 'Finished ' + ORD[placeOf(i)] : 'Finished ' + fmt(r.done), 4); }
}
// 0 = leading. Finished players rank by time, the rest by distance covered.
function placeOf(i) {
  if (!P2.on) return 0;
  const a = race.p[i], b = race.p[1 - i];
  if (a.done != null && b.done != null) return a.done <= b.done ? 0 : 1;
  if (a.done != null || b.done != null) return a.done != null ? 0 : 1;
  return a.total >= b.total ? 0 : 1;
}
function updateRace(dt) {
  if (race.ph === 'idle') return;
  if (race.ph === 'countdown') {
    const before = Math.ceil(race.t); race.t -= dt;
    if (race.t <= 0) { race.ph = 'running'; race.t0 = clock; banner(-1, 'GO!', 1); }
    else if (Math.ceil(race.t) !== before && race.t < 3) banner(-1, String(Math.ceil(race.t)), 0.9);
    return;
  }
  if (race.ph === 'running') {
    eachPlayer(trackProgress);
    const n = P2.on ? 2 : 1, done = race.p.slice(0, n).filter(r => r.done != null);
    if (done.length === n || (done.length && clock - race.t0 - Math.min(...done.map(r => r.done)) > 45)) {
      race.ph = 'done'; race.t = 7;
      if (n === 2) {
        const [a, b] = race.p, w = placeOf(0) === 0 ? 0 : 1, l = race.p[1 - w];
        banner(-1, 'Player ' + (w + 1) + ' wins' + (l.done != null ? ' by ' + Math.abs(a.done - b.done).toFixed(1) + ' s' : ''), 6);
      }
    }
    return;
  }
  race.t -= dt; if (race.t <= 0) race.ph = 'idle';
}
// one line per player for the race pill and the phone
function raceLine(i) {
  if (race.ph === 'idle') return '';
  if (race.ph === 'countdown') return race.t < 3 ? String(Math.ceil(race.t)) : 'Get ready';
  const r = race.p[i];
  if (r.done != null) return (P2.on ? ORD[placeOf(i)] + ' · ' : '') + fmt(r.done);
  return 'Lap ' + Math.max(1, Math.min(RACE_LAPS, r.laps + 1)) + '/' + RACE_LAPS + (P2.on ? ' · ' + ORD[placeOf(i)] : '') + ' · ' + fmt(clock - race.t0);
}

/* ================= driving help =================
   Per player: a car stuck on its side or roof, or pinned with the throttle down, is put back on the road on its
   own; driving against the loop shows "Wrong way"; hard hits are counted so the phone can buzz. */
const rec = [0, 1].map(() => ({ flip: 0, stuck: 0, wrong: 0, hits: 0, latch: false }));
const rTan = new V3();
function assistPlayer(i, dt) {
  const r = rec[i];
  if (car.impact > 0.3 && !r.latch) { r.hits++; r.latch = true; } else if (car.impact < 0.1) r.latch = false;
  if (!started || race.ph === 'countdown') { r.flip = r.stuck = r.wrong = 0; return; }
  r.flip = up.y < 0.3 && car.speed < 4 ? r.flip + dt : 0;
  r.stuck = (car.thrIn > 0.5 || car.brkIn > 0.5) && car.speed < 0.5 ? r.stuck + dt : 0;
  if (r.flip > 2 || r.stuck > 5) { const msg = r.flip > 2 ? 'Back on your wheels' : 'Unstuck'; resetCar(); banner(i, msg, 1.4); r.flip = r.stuck = 0; return; }
  roadQuery(car.pos.x, car.pos.z);
  if (RQ.d < ROAD_HALF + 4 && car.speed > 6) {
    const a = RQ.i, b = (a + 1) % road.N;
    rTan.set(road.xs[b] - road.xs[a], 0, road.zs[b] - road.zs[a]).normalize();
    r.wrong = rTan.x * car.vel.x + rTan.z * car.vel.z < -0.5 * car.speed ? r.wrong + dt : 0;
  } else r.wrong = 0;
  if (r.wrong > 1.2) banner(i, 'Wrong way', 0.25, true);
}

/* ================= on-screen race text, name tags, join hint ================= */
const extraCss = `
.rstat{top:calc(14px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);padding:6px 16px;font-family:var(--display);font-weight:700;font-size:22px;letter-spacing:.04em;white-space:nowrap;display:none}
.rstat.on{display:block}
#rstat2{top:calc(50% + 14px)}
.rban{top:38%;left:0;right:0;text-align:center;font-family:var(--display);font-weight:800;font-style:italic;font-size:76px;line-height:1;color:var(--accent);text-shadow:0 3px 18px rgba(0,0,0,.55);opacity:0;transition:opacity .2s}
.rban.on{opacity:1}.rban.warn{color:var(--hot)}
#rban2{display:none}
body.split .rban{font-size:56px}body.split #rban1{top:17%}body.split #rban2{display:block;top:67%}
#joinHint{left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);padding:8px 12px;display:none;align-items:center;gap:10px;max-width:min(440px,calc(100vw - 420px));font-size:11px;line-height:1.5;color:var(--dim)}
#joinHint.on{display:flex}#joinHint b{color:var(--text);font-weight:500}#joinHint .code{color:var(--accent);font-size:14px;letter-spacing:.12em}
#joinQr{flex:none;padding:4px;background:#ece2d0;border-radius:3px;line-height:0}#joinQr:empty{display:none}
body.split #joinHint,body.touch #joinHint{display:none!important}
@media (max-width:900px){#joinHint{display:none!important}}
`;
document.head.insertAdjacentHTML('beforeend', '<style>' + extraCss + '</style>');
document.body.insertAdjacentHTML('beforeend', '<div class="hud panel rstat" id="rstat1"></div><div class="hud panel rstat p2" id="rstat2"></div>' +
  '<div class="hud rban" id="rban1"></div><div class="hud rban" id="rban2"></div><div class="hud panel" id="joinHint"></div>');
const rbans = [$('rban1'), $('rban2')], rstats = [$('rstat1'), $('rstat2')], banT = [0, 0];
// i = -1 shows the text to everyone
function banner(i, text, secs, warn) {
  for (const k of i < 0 ? [0, 1] : [i]) {
    const el = rbans[k]; if (el.textContent !== text) el.textContent = text;
    el.classList.toggle('warn', !!warn); el.classList.add('on'); banT[k] = Math.max(banT[k], secs);
    if (!P2.on && k === 0 && i < 0) break;
  }
}
// solo, rban1 covers the whole screen; in split screen each half has its own
function updateRaceHud(dt) {
  for (let k = 0; k < 2; k++) if (banT[k] > 0 && (banT[k] -= dt) <= 0) rbans[k].classList.remove('on');
  for (let k = 0; k < 2; k++) {
    const t = k && !P2.on ? '' : raceLine(k), el = rstats[k];
    el.classList.toggle('on', !!t); if (el.textContent !== t) el.textContent = t;
  }
  const hint = $('joinHint'), show = started && !P2.on && link.ok && (!HOSTED || link.code);
  hint.classList.toggle('on', !!show);
  if (show && hint.dataset.code !== link.code) {
    hint.dataset.code = link.code;
    hint.innerHTML = HOSTED ? '<span id="joinQr"></span><span><b>Second player?</b> Scan this with a phone, or open this page on it and enter code <b class="code">' + link.code + '</b>. The screen splits when it joins.</span>'
      : '<span><b>Second player?</b> Open this same link on another phone signed in to this account and tap <b>Use this phone as a steering wheel</b>.</span>';
    if (HOSTED && window.QRCode) new QRCode($('joinQr'), { text: location.origin + location.pathname + '?pair=' + link.code, width: 56, height: 56, colorDark: '#0b1216', colorLight: '#ece2d0' });
  }
}
// "P1" / "P2" over each car, drawn on top of everything in the other player's view so they can find each other
function makeTag(txt, col) {
  const cv = document.createElement('canvas'); cv.width = 96; cv.height = 52;
  const g = cv.getContext('2d');
  g.fillStyle = col; g.beginPath(); g.moveTo(10, 2); g.lineTo(86, 2); g.quadraticCurveTo(94, 2, 94, 10); g.lineTo(94, 34); g.quadraticCurveTo(94, 42, 86, 42);
  g.lineTo(56, 42); g.lineTo(48, 50); g.lineTo(40, 42); g.lineTo(10, 42); g.quadraticCurveTo(2, 42, 2, 34); g.lineTo(2, 10); g.quadraticCurveTo(2, 2, 10, 2); g.fill();
  g.fillStyle = '#fff'; g.font = "italic 800 30px 'Saira Condensed', 'Arial Narrow', sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 48, 23);
  const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false, transparent: true }));
  s.scale.set(0.11, 0.06, 1); s.center.set(0.5, 0); s.position.y = 1.7; s.renderOrder = 10; s.visible = false;
  return s;
}
const tags = [makeTag('P1', '#c8321f'), makeTag('P2', '#1d5fa8')];
carView.root.add(tags[0]); carView2.root.add(tags[1]);
// before drawing player i's view: show only the other player's tag
function showTagsFor(i) { tags[0].visible = P2.on && i === 1; tags[1].visible = P2.on && i === 0; }
