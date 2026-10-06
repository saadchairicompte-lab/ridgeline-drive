// Ridgeline Drive: Vehicle physics at 120 Hz: rigid body, raycast suspension, combined-slip tyres with real wheel spin,
// engine + clutch + automatic gearbox + limited-slip diff, ABS/TCS/steering/drift assists, contacts, water.
// Classic script: top-level declarations are shared with the other files, loaded in the order index.html lists them.
'use strict';
/* ================= car physics ================= */
const car = {
  mass: 1250, invI: new V3(1 / (2167 * 1.25), 1 / (2393 * 1.25), 1 / (526 * 1.25)),
  pos: new V3(), vel: new V3(), q: new THREE.Quaternion(), w: new V3(),
  steer: 0, steerAngle: 0, thrIn: 0, brkIn: 0, hand: 0, thr: 0, brk: 0,
  gear: 1, reverse: false, revT: 0, rpm: 900, shiftT: 0, spin: 0, grounded: 0, impact: 0, speed: 0, fwdSpeed: 0,
  clutch: 1, tcsCut: 1, tcsActive: false, absActive: false,
  // driver aids; each can be switched off from the console or a future settings key
  assist: { abs: true, tcs: true, steer: true, stab: true },
  wheels: WHEELS.map(() => ({ comp: 0, Fs: 0, hit: false, t: 0, mu: 1, roll: 0.014, slip: 0, omega: 0, angle: 0, onRoad: true, contact: new V3(), n: new V3(0, 1, 0), mark: null,
    peakSR: 0.1, peakSA: 0.13, slide: 0.78, sr: 0, sa: 0, Fx: 0, Fy: 0 }))
};
const GEARS = [3.4, 2.25, 1.65, 1.28, 1.04, 0.87], FINAL = 3.7, REV = 3.2;
const IDLE = 900, LIMITER = 7300, WHEEL_I = 1.1, ENGINE_I = 0.22, DRIVELINE_EFF = 0.88;
const BRAKE_T = [1550, 1550, 850, 850], HAND_T = 2600, DIFF_PRELOAD = 120, DIFF_LOCK = 0.45;
// handling balance. With the aids on, even tyres and a sharper breakaway make drifts easy to start and hold.
// With them off, the car runs a planted setup: staggered tyres (more rear grip), a gentler breakaway on tarmac and
// a front-biased brake split (no electronic brake-force distribution without ABS), so it stays catchable by hand.
const BALANCE = {
  assisted: { front: 1, rear: 1, roadSlide: 0.78, rearBrake: 850 },
  raw: { front: 0.97, rear: 1.05, roadSlide: 0.88, rearBrake: 650 }
};
// surfaces: grip, rolling resistance, slip ratio and slip angle (rad) at peak grip, fraction of grip left when fully sliding
const SURF = {
  road: { mu: 1.12, roll: 0.014, peakSR: 0.10, peakSA: 0.13, slide: 0.78 },
  grass: { mu: 0.78, roll: 0.05, peakSR: 0.16, peakSA: 0.19, slide: 0.86 },
  dirt: { mu: 0.64, roll: 0.085, peakSR: 0.20, peakSA: 0.22, slide: 0.9 },
  mud: { mu: 0.45, roll: 0.2, peakSR: 0.22, peakSA: 0.24, slide: 0.92 }
};
function torqueAt(rpm) { if (rpm > LIMITER) return 0; return 235 + 185 * Math.sin(clamp((rpm - IDLE) / 5600, 0, 1) * Math.PI * 0.92); }
const engineBrake = rpm => rpm > IDLE * 1.05 ? 22 + rpm * 0.0065 : 0;
// normalised tyre curve: rises to 1 at the peak slip (s = 1), then falls smoothly to the sliding fraction
const tyreCurve = (s, slide) => s < 1 ? s * (2 - s) : 1 - (1 - slide) * ss(1, 3.2, s);
const qInv = new THREE.Quaternion(), up = new V3(), fwd = new V3(), left = new V3(), F = new V3(), T = new V3();
const anchor = new V3(), dir = new V3(), rel = new V3(), vp = new V3(), wf = new V3(), ws = new V3(), tv = new V3(), tv2 = new V3(), Ft = new V3();
function iInv(v, out) { out.copy(v).applyQuaternion(qInv); out.x *= car.invI.x; out.y *= car.invI.y; out.z *= car.invI.z; return out.applyQuaternion(car.q); }
function applyImpulse(J, r) { car.vel.addScaledVector(J, 1 / car.mass); tv2.crossVectors(r, J); iInv(tv2, tv2); car.w.add(tv2); }
function effMass(r, n) { tv2.crossVectors(r, n); iInv(tv2, tv2); tv2.cross(r); return 1 / car.mass + n.dot(tv2); }

const BODY_PTS = [];
for (const x of [-0.9, 0.9]) for (const z of [-2.15, 2.15]) BODY_PTS.push(new V3(x, -0.22, z));
for (const x of [-0.75, 0.75]) for (const z of [-0.95, 0.5]) BODY_PTS.push(new V3(x, 0.86, z));
BODY_PTS.push(new V3(0, -0.12, 2.25), new V3(0, -0.12, -2.25), new V3(0, 0.9, -0.25));
const cn = new V3(), cp = new V3();
function bodyContact(lp) {
  cp.copy(lp).applyQuaternion(car.q).add(car.pos);
  const h = H(cp.x, cp.z); if (cp.y >= h) return;
  normalAt(cp.x, cp.z, cn);
  const depth = (h - cp.y) * cn.y;
  car.pos.addScaledVector(cn, depth * 0.35);
  rel.subVectors(cp, car.pos); vp.crossVectors(car.w, rel).add(car.vel);
  const vn = vp.dot(cn); if (vn >= 0) return;
  const j = -(1.2) * vn / effMass(rel, cn);
  Ft.copy(cn).multiplyScalar(j);
  tv.copy(vp).addScaledVector(cn, -vn); const vt = tv.length();
  if (vt > 0.01) { tv.multiplyScalar(1 / vt); const jt = Math.min(vt / effMass(rel, tv), 0.55 * j); Ft.addScaledVector(tv, -jt); }
  applyImpulse(Ft, rel);
  car.impact = Math.max(car.impact, Math.min(1, -vn / 8));
}
function treeCollisions() {
  const ctx = Math.floor(car.pos.x / TILE), ctz = Math.floor(car.pos.z / TILE);
  tv.set(fwd.x, 0, fwd.z).normalize();
  for (const off of [1.35, 0, -1.35]) {
    const px = car.pos.x + tv.x * off, pz = car.pos.z + tv.z * off;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const t = tiles.get(tkey(ctx + dx, ctz + dz)); if (!t) continue; const c = t.col;
      for (let i = 0; i < c.length; i += 4) {
        const ddx = px - c[i], ddz = pz - c[i + 1], rr = c[i + 2] + 0.95;
        if (ddx * ddx + ddz * ddz > rr * rr || car.pos.y - c[i + 3] > 6) continue;
        const d = Math.sqrt(ddx * ddx + ddz * ddz) || 0.01; cn.set(ddx / d, 0, ddz / d);
        car.pos.addScaledVector(cn, (rr - d) * 0.8);
        rel.set(px - car.pos.x, 0, pz - car.pos.z); vp.crossVectors(car.w, rel).add(car.vel);
        const vn = vp.dot(cn); if (vn >= 0) continue;
        const j = -1.3 * vn / effMass(rel, cn); Ft.copy(cn).multiplyScalar(j); applyImpulse(Ft, rel);
        car.impact = Math.max(car.impact, Math.min(1, -vn / 10));
        if (-vn > 3) onCrash();
      }
    }
  }
}

const brakeT = [0, 0, 0, 0], WD = [0, 0, 0, 0].map(() => ({ wf: new V3(), ws: new V3(), rel: new V3(), vx: 0, vy: 0, D: 0, den: 4, alpha: 0, Fx: 0, Fy: 0 }));
function physicsStep(dt) {
  const q = car.q; qInv.copy(q).invert();
  up.set(0, 1, 0).applyQuaternion(q); fwd.set(0, 0, 1).applyQuaternion(q); left.set(1, 0, 0).applyQuaternion(q);
  const m = car.mass, as = car.assist, bal = as.stab ? BALANCE.assisted : BALANCE.raw; F.set(0, -9.81 * m, 0); T.set(0, 0, 0);
  const speed = car.vel.length(), fwdSpeed = car.vel.dot(fwd);
  car.speed = speed; car.fwdSpeed = fwdSpeed;
  const vLat = car.vel.dot(left), beta = fwdSpeed > 2 ? Math.atan2(vLat, fwdSpeed) : 0;

  // gearbox: brake at standstill selects reverse, throttle selects drive; automatic shifts on road speed
  if (!car.reverse) { if (car.brkIn > 0.1 && fwdSpeed < 0.8) { car.revT += dt; if (car.revT > 0.25) { car.reverse = true; car.revT = 0; } } else car.revT = 0; }
  else if (car.thrIn > 0.1 && fwdSpeed > -0.8) car.reverse = false;
  car.thr = car.reverse ? car.brkIn : car.thrIn;
  car.brk = car.reverse ? car.thrIn : car.brkIn;
  const wheelRpm = Math.abs(fwdSpeed) / R_WHEEL * 9.549;
  car.shiftT -= dt;
  if (!car.reverse && car.shiftT <= 0) {
    const g = car.gear;
    if (wheelRpm * GEARS[g - 1] * FINAL > 6900 && g < 6) { car.gear++; car.shiftT = 0.18; }
    else if (g > 1 && wheelRpm * GEARS[g - 2] * FINAL < 6300 && wheelRpm * GEARS[g - 1] * FINAL < (car.thr > 0.9 ? 4200 : car.thr > 0.4 ? 3200 : 2300)) { car.gear--; car.shiftT = 0.12; }
  }
  if (car.reverse) car.gear = 1;
  const G = car.reverse ? -REV * FINAL : GEARS[car.gear - 1] * FINAL;
  const hold = car.thr < 0.05 && car.brk < 0.05 && Math.abs(fwdSpeed) < 0.6;
  let thr = car.thr * car.tcsCut;
  if (car.reverse && fwdSpeed < -13) thr = 0;

  // pass 1: suspension raycasts against the heightfield (wheel layout is read live: car.glb can change it)
  const maxLen = SUSP.rest + R_WHEEL;
  dir.copy(up).negate();
  for (let k = 0; k < 4; k++) {
    const W = WHEELS[k], S = car.wheels[k];
    anchor.set(W.x, SUSP.anchorY, W.z).applyQuaternion(q).add(car.pos);
    S.hit = false;
    if (dir.y < -0.3) {
      let t = 0;
      for (let it = 0; it < 4; it++) { const px = anchor.x + dir.x * t, pz = anchor.z + dir.z * t; t += (anchor.y + dir.y * t - H(px, pz)) / -dir.y; }
      if (t < maxLen) {
        S.hit = true; t = Math.max(t, 0); S.t = t;
        const comp = maxLen - t, cv = (comp - S.comp) / dt; S.comp = comp;
        // progressive spring, stiffer rebound than bump damping, hard bump stop near full travel
        let Fs = SUSP.k * comp * (1 + 0.6 * comp / SUSP.rest) + (cv > 0 ? 0.85 : 1.25) * SUSP.c * cv;
        if (comp > SUSP.rest * 0.85) Fs += (comp - SUSP.rest * 0.85) * 250000;
        S.Fs = Math.max(Fs, 0);
        S.contact.copy(anchor).addScaledVector(dir, t);
        normalAt(S.contact.x, S.contact.z, S.n);
        const h = H(S.contact.x, S.contact.z);
        S.onRoad = lastRoadD < ROAD_HALF + 0.4;
        const sf = S.onRoad ? SURF.road : h < WATER + 0.6 ? SURF.mud : h < 3.4 ? SURF.dirt : SURF.grass;
        S.mu = sf.mu; S.roll = sf.roll; S.peakSR = sf.peakSR; S.peakSA = sf.peakSA; S.slide = sf === SURF.road ? bal.roadSlide : sf.slide;
      }
    }
    if (!S.hit) { S.comp = 0; S.Fs = 0; S.t = maxLen; }
  }
  // anti-roll bars
  const arb = (a, b, K) => { const A = car.wheels[a], B = car.wheels[b]; const f = (A.comp - B.comp) * K; if (A.hit) A.Fs = Math.max(0, A.Fs + f); if (B.hit) B.Fs = Math.max(0, B.Fs - f); };
  arb(0, 1, 16000); arb(2, 3, 9000);

  // steering: speed-sensitive rack, caster self-alignment pulls the wheels toward the direction of travel
  const L = Math.abs(WHEELS[0].z - WHEELS[2].z) || 2.6, tw = Math.abs(WHEELS[0].x - WHEELS[1].x) || 1.6;
  const maxSteer = 0.6 / (1 + speed * 0.05);
  if (as.steer) car.steerAngle = -car.steer * maxSteer + clamp(beta * 0.55, -0.4, 0.4) * ss(3, 10, speed);
  else {
    // countersteer range: steering toward the direction of travel can always reach the slide angle plus the tyres' peak slip
    const csRange = Math.max(maxSteer, Math.min(0.6, Math.abs(beta) + 0.15));
    const steerIn = -car.steer * ((-car.steer) * beta > 0 ? csRange : maxSteer);
    // assist off, hands off the wheel: caster turns the front wheels toward where the front axle is travelling, as in a real car
    const caster = fwdSpeed > 1 ? clamp(Math.atan2(vLat + car.w.dot(up) * WHEELS[0].z, fwdSpeed), -0.5, 0.5) * ss(2, 8, speed) : 0;
    car.steerAngle = steerIn + caster * (1 - Math.abs(car.steer));
  }
  const ta = Math.abs(car.steerAngle), Rt = ta > 1e-3 ? L / Math.tan(ta) : 1e9;
  const aIn = Math.atan(L / Math.max(Rt - tw / 2, 0.5)), aOut = Math.atan(L / (Rt + tw / 2));

  // per-wheel contact frame and slip angle for this step
  let grounded = 0;
  for (let k = 0; k < 4; k++) {
    const W = WHEELS[k], S = car.wheels[k], d = WD[k];
    d.Fx = d.Fy = 0; d.D = 0;
    if (!S.hit) continue;
    grounded++;
    anchor.set(W.x, SUSP.anchorY, W.z).applyQuaternion(q);
    Ft.copy(up).multiplyScalar(S.Fs); F.add(Ft); tv.crossVectors(anchor, Ft); T.add(tv);
    // Ackermann (60 %): the inner front wheel steers tighter than the outer one
    let a = 0;
    if (W.front) { const inner = (car.steerAngle > 0) === (W.x > 0); a = Math.sign(car.steerAngle) * (ta + 0.6 * ((inner ? aIn : aOut) - ta)); }
    const n = S.n;
    d.wf.set(Math.sin(a), 0, Math.cos(a)).applyQuaternion(q); d.wf.addScaledVector(n, -d.wf.dot(n)).normalize();
    d.ws.crossVectors(n, d.wf).normalize();
    d.rel.subVectors(S.contact, car.pos); vp.crossVectors(car.w, d.rel).add(car.vel);
    d.vx = vp.dot(d.wf); d.vy = vp.dot(d.ws);
    const Fz = S.Fs;
    d.D = S.mu * (W.front ? bal.front : bal.rear) * Fz * (1 - Math.min(Fz, 9000) / 9000 * 0.12);
    d.den = Math.max(Math.abs(d.vx), 3);
    d.alpha = Math.atan2(d.vy, Math.max(Math.abs(d.vx), 3.5));
  }
  car.grounded = grounded;

  // ideal ABS: cap brake torque at what the tyre can put down, so the wheel never locks under the pedal
  let absOn = false;
  for (let k = 0; k < 4; k++) {
    const S = car.wheels[k], d = WD[k], front = WHEELS[k].front;
    let tb = car.brk * (front ? BRAKE_T[k] : bal.rearBrake);
    if (hold) tb = Math.max(tb, 0.7 * BRAKE_T[k]);
    if (as.abs && tb > 0 && S.hit && Math.abs(d.vx) > 2.5) {
      const sy = Math.min(Math.abs(d.alpha) / S.peakSA, 1), cap = d.D * R_WHEEL * Math.max(0.35, Math.sqrt(1 - sy * sy)) * 1.02;
      if (tb > cap) { tb = cap; absOn = true; }
    }
    if (!front && car.hand > 0) tb += car.hand * HAND_T;
    brakeT[k] = tb + (S.hit ? S.roll * S.Fs * R_WHEEL : 4);
  }
  car.absActive = absOn;

  // pass 2: wheel spin, drivetrain and tyre forces in 4 substeps (the wheel/tyre loop is stiff)
  const N = 4, h = dt / N, clutchIn = car.shiftT <= 0;
  let lockedToEngine = false, srRear = 0;
  for (let sub = 0; sub < N; sub++) {
    const RL = car.wheels[2], RR = car.wheels[3];
    const eRpm = (RL.omega + RR.omega) * 0.5 * G * 9.549;
    let Taxle = 0; lockedToEngine = false;
    if (clutchIn) {
      const launch = IDLE + thr * 1600;
      if (eRpm >= launch && eRpm > IDLE * 1.02) {
        // clutch locked: the engine turns with the rear wheels
        lockedToEngine = true; car.rpm = eRpm;
        Taxle = (torqueAt(eRpm) * thr - engineBrake(eRpm) * (1 - thr)) * G * DRIVELINE_EFF;
      } else {
        // clutch slipping (pulling away) or open at idle
        car.rpm += (Math.max(launch, eRpm, IDLE) - car.rpm) * Math.min(1, h * 12);
        Taxle = thr > 0.02 ? torqueAt(car.rpm) * thr * G * DRIVELINE_EFF : 0;
      }
    } else {
      // mid-shift: clutch open, engine blips toward the new gear's speed
      car.rpm += (Math.max(eRpm, IDLE) - car.rpm) * Math.min(1, h * 14);
    }
    const Iadd = lockedToEngine ? ENGINE_I * G * G * 0.5 : 0;
    // limited-slip differential: couples the rear wheels up to preload + a share of the drive torque
    const Iw = WHEEL_I + Iadd, lim = DIFF_PRELOAD + DIFF_LOCK * Math.abs(Taxle);
    const Tc = clamp((RL.omega - RR.omega) * Iw / (2 * h), -lim, lim);
    for (let k = 0; k < 4; k++) {
      const S = car.wheels[k], d = WD[k], front = WHEELS[k].front;
      let Fx = 0, Fy = 0, kx = 0;
      if (S.hit && d.D > 1) {
        const sr = (S.omega * R_WHEEL - d.vx) / d.den;
        const sx = sr / S.peakSR, sy = d.alpha / S.peakSA, s = Math.hypot(sx, sy);
        if (s > 1e-6) { const f = d.D * tyreCurve(s, S.slide) / s; Fx = f * sx; Fy = -f * sy; }
        kx = d.D * 2 / S.peakSR * R_WHEEL / d.den;
        S.sr = sr; S.sa = d.alpha;
        if (!front) srRear = Math.max(srRear, sr);
      } else { S.sr = 0; S.sa = 0; }
      d.Fx += Fx / N; d.Fy += Fy / N;
      const I = front ? WHEEL_I : Iw;
      const Tdrive = front ? 0 : Taxle * 0.5 + (k === 2 ? -Tc : Tc);
      // semi-implicit update: tyre stiffness enters the denominator so the step stays stable
      const den = I + h * R_WHEEL * kx;
      const wFree = S.omega + h * (Tdrive - Fx * R_WHEEL) / den, dB = h * brakeT[k] / den;
      S.omega = Math.abs(wFree) <= dB ? 0 : wFree - Math.sign(wFree) * dB;
    }
  }
  car.clutch = lockedToEngine ? 1 : 0;
  car.rpm = clamp(car.rpm, IDLE * 0.9, LIMITER + 400);
  car.spin = clamp(srRear, 0, 1);

  // traction control: trims the throttle when the rears spin up while the car is still pointing straight
  if (as.tcs && !car.reverse && car.hand < 0.1 && Math.abs(car.steer) < 0.45 && Math.abs(beta) < 0.15 && srRear > 2.2 * car.wheels[2].peakSR) { car.tcsCut = Math.max(0.15, car.tcsCut - dt * 8); car.tcsActive = true; }
  else { car.tcsCut = Math.min(1, car.tcsCut + dt * 3); car.tcsActive = car.tcsCut < 0.98; }

  // apply the averaged tyre forces
  for (let k = 0; k < 4; k++) {
    const S = car.wheels[k], d = WD[k];
    if (!S.hit) { S.slip = 0; S.Fx = S.Fy = 0; continue; }
    S.Fx = d.Fx; S.Fy = d.Fy;
    Ft.copy(d.wf).multiplyScalar(d.Fx).addScaledVector(d.ws, d.Fy);
    F.add(Ft); tv.crossVectors(d.rel, Ft); T.add(tv);
    const slipVel = Math.hypot(S.omega * R_WHEEL - d.vx, d.vy);
    const s = Math.hypot(S.sr / S.peakSR, S.sa / S.peakSA);
    S.slip = Math.max(slipVel - 1.4, 0) * 0.22 * ss(0.6, 1.1, s);
  }
  // drift stabiliser (assist): past ~40 degrees of body slip, a yaw moment keeps the angle catchable
  if (as.stab && grounded >= 3 && fwdSpeed > -1 && speed > 5) {
    const b = Math.atan2(vLat, Math.max(fwdSpeed, 0.1)), k = ss(0.7, 1.4, Math.abs(b)) * ss(5, 12, speed);
    T.addScaledVector(up, (b * 6000 - car.w.dot(up) * 2000) * k);
  }

  // aero: drag, and downforce split over the axles (slightly rear-biased for high-speed stability)
  F.addScaledVector(car.vel, -0.40 * speed);
  const df = 0.5 * speed * speed;
  for (const [z, share] of [[WHEELS[0].z, 0.44], [WHEELS[2].z, 0.56]]) {
    Ft.copy(up).multiplyScalar(-df * share); F.add(Ft);
    anchor.set(0, 0, z).applyQuaternion(q); tv.crossVectors(anchor, Ft); T.add(tv);
  }
  // water: buoyancy + heavy drag
  const sub = clamp((WATER + 0.35 - car.pos.y) / 0.9, 0, 1);
  if (sub > 0) { F.y += 9.81 * m * 1.25 * sub; F.addScaledVector(car.vel, -m * 1.6 * sub); car.w.multiplyScalar(1 - 1.5 * sub * dt);
    if (grounded < 2) { tv.set(fwd.x, 0, fwd.z).normalize(); F.addScaledVector(tv, (car.thr - car.brk) * m * 2.2 * sub); T.addScaledVector(up, -car.steer * m * 1.2 * sub * Math.sign(fwdSpeed || 1)); } }

  car.vel.addScaledVector(F, dt / m);
  iInv(T, tv); car.w.addScaledVector(tv, dt);
  car.w.multiplyScalar(1 - (grounded ? 0.02 : 0.25) * dt);
  for (let i = 0; i < BODY_PTS.length; i++) bodyContact(BODY_PTS[i]);
  treeCollisions();
  car.pos.addScaledVector(car.vel, dt);
  const wx = car.w.x, wy = car.w.y, wz = car.w.z, qx = q.x, qy = q.y, qz = q.z, qw = q.w, h2 = 0.5 * dt;
  q.set(qx + h2 * (wx * qw + wy * qz - wz * qy), qy + h2 * (wy * qw + wz * qx - wx * qz), qz + h2 * (wz * qw + wx * qy - wy * qx), qw + h2 * (-wx * qx - wy * qy - wz * qz)).normalize();
}

function placeOnRoad(i) {
  const { xs, zs, hs, N } = road, n = (i + 1) % N;
  car.pos.set(xs[i], hs[i] + 0.9, zs[i]);
  car.q.setFromAxisAngle(new V3(0, 1, 0), Math.atan2(xs[n] - xs[i], zs[n] - zs[i]));
  car.vel.set(0, 0, 0); car.w.set(0, 0, 0); car.gear = 1; car.reverse = false; car.rpm = 900;
  car.shiftT = 0; car.tcsCut = 1;
  car.wheels.forEach(w => { w.comp = 0; w.omega = 0; w.mark = null; });
}
function resetCar() {
  const { xs, zs, N } = road; let best = 0, bd = 1e18;
  for (let i = 0; i < N; i++) { const d = (xs[i] - car.pos.x) ** 2 + (zs[i] - car.pos.z) ** 2; if (d < bd) { bd = d; best = i; } }
  placeOnRoad(best); lap.armed = false; lap.start = 0; toast('Back on the road');
}
