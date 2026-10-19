// Ridgeline Drive: Frame loop, visual sync of physics state, and boot.
// Classic script: top-level declarations are shared with the other files, loaded in the order index.html lists them.
'use strict';
/* ================= main loop ================= */
let started = false, sunk = 0, hudT = 0, last = performance.now(), acc = 0;
const DT = 1 / 120, sideV = new V3();
function resize() {
  const w = innerWidth, h = innerHeight, vh = twoUp() ? h / 2 : h;   // split screen: each player gets half the height
  renderer.setSize(w, h, false); camera.aspect = w / vh; camera.updateProjectionMatrix();
  smokeMat.uniforms.uScale.value = vh * renderer.getPixelRatio() / 2; fitCanvas(gauge); fitCanvas(mapC);
  if (hud2) { fitCanvas(hud2.gauge); fitCanvas(hud2.map); }
}
addEventListener('resize', resize);
function syncVisuals(dt, view, mats) {
  view.root.position.copy(car.pos); view.root.quaternion.copy(car.q);
  const maxLen = SUSP.rest + R_WHEEL;
  for (let k = 0; k < 4; k++) {
    const W = WHEELS[k], S = car.wheels[k], wv = view.wheels[k];
    wv.holder.position.y = SUSP.anchorY - (Math.min(S.t, maxLen) - R_WHEEL);
    wv.holder.rotation.y = W.front ? car.steerAngle : 0;
    S.angle += S.omega * dt; wv.spin.rotation.x = S.angle;
    if (S.hit && S.slip > 0.35) {
      sideV.crossVectors(S.n, fwd).normalize(); addSkid(S, sideV);
      const n = Math.min(3, Math.floor(S.slip * 2.5 * (60 * dt) + Math.random()));
      for (let i = 0; i < n; i++) emitSmoke(S.contact, car.vel, !S.onRoad);
    } else if (S.hit && !S.onRoad && car.speed > 6 && Math.random() < car.speed / 60) { emitSmoke(S.contact, car.vel, true); S.mark = null; }
    else S.mark = null;
  }
  mats.tail.emissiveIntensity = car.brk > 0.1 ? 4 : 0.7;
  mats.rev.emissiveIntensity = car.reverse ? 2.5 : 0;
}
function frame(now) {
  requestAnimationFrame(frame);
  if (padMode) return;   // this page is a phone wheel for another page (controls.js): no game frame here
  const dt = Math.min((now - last) / 1000, 0.05); last = now; clock += dt;
  pollWheels();
  eachPlayer(i => readInput(dt, i));
  if (race.ph === 'countdown') eachPlayer(() => { car.thrIn = car.brkIn = 0; car.hand = 1; });   // held on the grid
  acc += dt; let n = 0; while (acc >= DT && n < 8) { stepCars(DT); acc -= DT; n++; } if (n >= 8) acc = 0;
  eachPlayer(i => {
    if (car.pos.y < -60 || !isFinite(car.pos.x)) resetCar();
    sunk = (car.pos.y < WATER - 0.1 && car.speed < 3) ? sunk + dt : 0;
    if (sunk > 4) { resetCar(); toast(i ? 'Player 2 towed out of the lake' : 'Towed out of the lake'); sunk = 0; }
    syncVisuals(dt, i ? carView2 : carView, i ? carMats2 : carMats);
    updateCamera(dt);
    if (started) updateLap(dt);
    assistPlayer(i, dt);
  });
  updateRace(dt); updateRaceHud(dt);
  updateTiles(car.pos.x, car.pos.z, 0, twoUp() ? P2.state.pos.x : null, twoUp() ? P2.state.pos.z : null);
  updateSmoke(dt);
  updateAudio();
  hudT -= dt;
  if (hudT <= 0) { hudT = 1 / 30; eachPlayer(i => drawHud(i ? hud2 : hud, i ? hud2.gctx : gctx, i ? hud2.mctx : mctx)); }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) hud.toast.classList.remove('on'); }
  renderViews();
}
function drawHud(h, gc, mc) {
  h.spd.textContent = Math.round(Math.abs(car.fwdSpeed) * 3.6);
  h.gear.textContent = car.reverse ? 'R' : (car.speed < 0.3 && car.thr < 0.05 ? 'N' : car.gear);
  updateLamps(h);
  h.lap.textContent = lap.armed ? fmt(clock - lap.start) : '--:--.---';
  h.best.textContent = fmt(lap.best); h.last.textContent = fmt(lap.last); h.dt.textContent = drift.total.toLocaleString();
  if (drift.cur > 20) { h.dn.innerHTML = Math.round(drift.cur) + '<small>DRIFT</small>'; h.dn.style.opacity = 1; } else h.dn.style.opacity = 0;
  drawGauge(gc); drawMap(mc);
}
// sun, sky dome and water follow the car and camera that are being drawn
function placeScene() {
  sun.position.copy(car.pos).addScaledVector(sunDir, 300); sun.target.position.copy(car.pos);
  sky.position.copy(camera.position); skyMat.uniforms.time.value = clock;
  water.position.set(Math.round(camera.position.x / 50) * 50, WATER, Math.round(camera.position.z / 50) * 50);
  waterNormal.offset.set((water.position.x / 4000 * 160 + clock * 0.02) % 1, (water.position.z / -4000 * 160 + clock * 0.012) % 1);
}
// One view, or two stacked: player 1 on top, player 2 below, each drawn with its own camera.
function renderViews() {
  if (!twoUp()) { showTagsFor(0); placeScene(); renderer.render(scene, camera); return; }
  const w = innerWidth, h = innerHeight, top = Math.floor(h / 2);
  renderer.setScissorTest(true);
  eachPlayer(i => {
    const y = i ? 0 : h - top, vh = i ? h - top : top;
    showTagsFor(i); placeScene(); renderer.setViewport(0, y, w, vh); renderer.setScissor(0, y, w, vh);
    smokeMat.uniforms.uScale.value = vh * renderer.getPixelRatio() / 2;
    secondView = i === 1; renderer.render(scene, camera);
  });
  secondView = false; renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h);
}

async function boot(data) {
  resize();
  loadCarModel();
  await propsReady;
  placeRoadside();
  updateTiles(0, 0, 0);
  if (data && data.pos) { car.pos.fromArray(data.pos); car.q.fromArray(data.q); } else placeOnRoad(road.N - 12);
  if (data && data.drift) drift.total = data.drift;
  if (data && data.best) lap.best = data.best;
  curTx = 1e9; updateTiles(car.pos.x, car.pos.z, 12);
  for (let i = 0; i < 90; i++) physicsStep(DT);
  up.set(0, 1, 0).applyQuaternion(car.q); fwd.set(0, 0, 1).applyQuaternion(car.q); left.set(1, 0, 0).applyQuaternion(car.q);
  requestAnimationFrame(frame);
  const go = $('go'); go.disabled = false; go.textContent = 'Start driving';
  const start = () => { if (started) return; started = true; $('intro').hidden = true; initAudio(); canvas.focus(); toast('Drive to the chequered gantry to start a lap'); };
  go.addEventListener('click', start);
  addEventListener('keydown', e => { if (!started && (e.code === 'Enter')) start(); });
  window.claude?.hot?.snapshot?.(() => ({ pos: car.pos.toArray(), q: car.q.toArray(), drift: drift.total, best: lap.best }));
  window.__game = { car, road, H, tiles, buildTile, step: physicsStep, keys, readInput, renderer, get started() { return started; }, start, P2, seats, setTwoPlayer, swapPlayer, stepCars, link, race, startRace, rec };
}
setTimeout(() => { window.claude?.hot?.ready ? window.claude.hot.ready(boot) : boot(window.claude?.hot?.data ?? {}); }, 30);
