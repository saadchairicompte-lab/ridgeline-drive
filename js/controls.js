// Ridgeline Drive: Keyboard, touch, gamepad and phone-wheel input; chase, far and cockpit cameras; WebAudio engine sound.
// Classic script: top-level declarations are shared with the other files, loaded in the order index.html lists them.
'use strict';
/* ================= input ================= */
const keys = {};
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return; keys[e.code] = true;
  if (!started) return;
  if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'KeyP') { paintIdx = (paintIdx + 1) % PAINTS.length; carMats.paint.color.copy(C(PAINTS[paintIdx])); }
  if (e.code === 'KeyT') { const a = car.assist, on = !(a.abs && a.tcs && a.steer && a.stab); a.abs = a.tcs = a.steer = a.stab = on; toast(on ? 'Assists on' : 'Assists off'); }
  if (e.code === 'KeyM') { muted = !muted; if (audio) audio.master.gain.value = muted ? 0 : 0.5; toast(muted ? 'Sound off' : 'Sound on'); }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const touch = { L: false, R: false, G: false, B: false, H: false };
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
for (const [id, k] of [['tL', 'L'], ['tR', 'R'], ['tG', 'G'], ['tB', 'B'], ['tH', 'H']]) {
  const b = document.getElementById(id);
  const on = v => e => { e.preventDefault(); touch[k] = v; b.classList.toggle('on', v); };
  b.addEventListener('pointerdown', on(true)); b.addEventListener('pointerup', on(false)); b.addEventListener('pointercancel', on(false)); b.addEventListener('pointerleave', on(false));
}
function readInput(dt) {
  let thr = (keys.KeyW || keys.ArrowUp || touch.G) ? 1 : 0, brk = (keys.KeyS || keys.ArrowDown || touch.B) ? 1 : 0;
  let st = ((keys.KeyD || keys.ArrowRight || touch.R) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft || touch.L) ? 1 : 0);
  let hb = (keys.Space || touch.H) ? 1 : 0, analog = false;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const ax = p.axes[0] || 0; if (Math.abs(ax) > 0.12) { st = ax; analog = true; }
    if (p.buttons[7]) thr = Math.max(thr, p.buttons[7].value); if (p.buttons[6]) brk = Math.max(brk, p.buttons[6].value);
    if (p.buttons[0] && p.buttons[0].pressed) hb = 1;
    if (p.buttons[3] && p.buttons[3].pressed && !p._y) resetCar(); p._y = p.buttons[3] && p.buttons[3].pressed;
  }
  const w = wheelInput();
  if (w) {
    if (!started && w.g > 0.5) window.__game?.start?.();
    thr = Math.max(thr, w.g); brk = Math.max(brk, w.b); if (w.h) hb = 1;
    if (st === 0) { car.steer += (w.s - car.steer) * Math.min(1, 25 * dt); st = car.steer; analog = true; }
  }
  if (!started) { thr = brk = st = 0; hb = 0; }
  if (analog) car.steer = st;
  else { const rate = (st === 0 || Math.sign(st) !== Math.sign(car.steer)) ? 6 : 2.8; car.steer += clamp(st - car.steer, -rate * dt, rate * dt); }
  car.thrIn += clamp(thr - car.thrIn, -8 * dt, 5 * dt);
  car.brkIn += clamp(brk - car.brkIn, -10 * dt, 8 * dt);
  car.hand = hb;
}


/* ================= camera ================= */
let camMode = 0, camYaw = 0, camInit = false, attractT = 0;
const camTarget = new V3(), camLook = new V3(), flatF = new V3();
function updateCamera(dt) {
  flatF.set(fwd.x, 0, fwd.z); if (flatF.lengthSq() < 1e-4) flatF.set(0, 0, 1); flatF.normalize();
  const yaw = Math.atan2(flatF.x, flatF.z);
  if (!started) {
    attractT += dt * 0.12;
    const a = yaw + 2.4 + Math.sin(attractT) * 0.9;
    camera.position.set(car.pos.x + Math.sin(a) * 8.5, car.pos.y + 2.2, car.pos.z + Math.cos(a) * 8.5);
    camera.position.y = Math.max(camera.position.y, H(camera.position.x, camera.position.z) + 1);
    camera.lookAt(car.pos.x - Math.sin(a) * 1.5, car.pos.y + 0.4, car.pos.z - Math.cos(a) * 1.5);
    camera.fov = 50; camera.updateProjectionMatrix(); camYaw = yaw; camInit = false; return;
  }
  let d = yaw - camYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
  camYaw += d * (1 - Math.exp(-(camMode === 2 ? 30 : 4.5) * dt));
  const sp = car.speed;
  if (camMode === 2) {
    camera.position.copy(EYE).applyQuaternion(car.q).add(car.pos);
    camLook.set(EYE.x, 0.5, 12).applyQuaternion(car.q).add(car.pos);
    camera.up.copy(up); camera.lookAt(camLook); camera.up.set(0, 1, 0);
  } else {
    const dist = camMode === 0 ? 6.4 + sp * 0.03 : 11 + sp * 0.04, hgt = camMode === 0 ? 2.1 : 3.8;
    camTarget.set(car.pos.x - Math.sin(camYaw) * dist, car.pos.y + hgt, car.pos.z - Math.cos(camYaw) * dist);
    camTarget.y = Math.max(camTarget.y, H(camTarget.x, camTarget.z) + 1.0, WATER + 0.8);
    if (!camInit) { camera.position.copy(camTarget); camInit = true; }
    camera.position.lerp(camTarget, 1 - Math.exp(-10 * dt));
    camLook.set(car.pos.x + Math.sin(camYaw) * 3, car.pos.y + 0.9, car.pos.z + Math.cos(camYaw) * 3);
    camera.lookAt(camLook);
  }
  const sh = car.impact * 0.25;
  if (sh > 0.001) { camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh; }
  car.impact *= Math.exp(-6 * dt);
  camera.fov = (camMode === 2 ? 70 : 60) + Math.min(sp, 70) / 70 * 16; camera.updateProjectionMatrix();
}


/* Bonnet view: the Blender car has no interior, so the eye sits just ahead of the windscreen, about 1 m above
   the ground, with a strip of bonnet at the bottom of the frame. */
const EYE = new V3(0, 0.6, 1.12);


/* ================= audio ================= */
let audio = null, muted = false;
function initAudio() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)(), master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
    const filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = 4; filt.frequency.value = 700;
    const eg = ac.createGain(); eg.gain.value = 0.1; filt.connect(eg); eg.connect(master);
    const o1 = ac.createOscillator(); o1.type = 'sawtooth'; const o2 = ac.createOscillator(); o2.type = 'square'; const o3 = ac.createOscillator(); o3.type = 'sawtooth';
    const g2 = ac.createGain(); g2.gain.value = 0.5; const g3 = ac.createGain(); g3.gain.value = 0.25;
    o1.connect(filt); o2.connect(g2); g2.connect(filt); o3.connect(g3); g3.connect(filt);
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const mkNoise = (type, f, q) => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; const bf = ac.createBiquadFilter(); bf.type = type; bf.frequency.value = f; bf.Q.value = q; const g = ac.createGain(); g.gain.value = 0; s.connect(bf); bf.connect(g); g.connect(master); s.start(); return { g, bf }; };
    const screech = mkNoise('bandpass', 1500, 7), wind = mkNoise('lowpass', 420, 0.7), rumble = mkNoise('lowpass', 160, 1);
    [o1, o2, o3].forEach(o => o.start());
    audio = { ac, master, filt, eg, o1, o2, o3, screech, wind, rumble };
    if (muted) master.gain.value = 0;
  } catch (e) { audio = null; }
}
function updateAudio() {
  if (!audio) return;
  const t = audio.ac.currentTime, f = car.rpm / 60 * 2;
  audio.o1.frequency.setTargetAtTime(f, t, 0.02); audio.o2.frequency.setTargetAtTime(f * 0.5, t, 0.02); audio.o3.frequency.setTargetAtTime(f * 1.01 + 1.5, t, 0.02);
  audio.filt.frequency.setTargetAtTime(300 + car.thr * 1400 + car.rpm * 0.18, t, 0.05);
  audio.eg.gain.setTargetAtTime(0.05 + car.thr * 0.09, t, 0.05);
  let slip = 0, off = 0; car.wheels.forEach(w => { if (w.hit) { if (w.onRoad) slip = Math.max(slip, w.slip, clamp(Math.abs(w.sr || 0) - 0.12, 0, 1) * 1.6); else off += 0.25; } });
  audio.screech.g.gain.setTargetAtTime(clamp(slip - 0.3, 0, 1) * 0.22, t, 0.05);
  audio.screech.bf.frequency.setTargetAtTime(1200 + clamp(slip, 0, 2) * 500, t, 0.1);
  audio.wind.g.gain.setTargetAtTime(Math.min(car.speed * car.speed * 0.00006, 0.35), t, 0.1);
  audio.rumble.g.gain.setTargetAtTime(off * Math.min(car.speed / 20, 1) * 0.5, t, 0.08);
}


/* ================= phone as steering wheel =================
   Both ends open this same page. The phone switches to "wheel" mode (padMode: main.js skips its frame loop)
   and publishes {wheel} in its room presence about 30 times a second: steering, analog pedals, and counters
   for one-shot buttons. The computer reads the newest wheel from the same viewer's other page and publishes
   {car} (speed, gear) back so the phone can show it. Presence is absolute state, so a dropped update just
   means the next one wins.
   Steering comes from tilt (devicemotion or deviceorientation) when the page is given the motion sensor, or
   from a thumb pad: the claude.ai frame may not pass motion sensors through, so touch is the fallback and
   can also be picked by hand. */
let padMode = false, lastCarPub = 0, wheelSeen = { r: 0, c: 0 };
const WHEEL_LOCK = 0.8;                       // phone rotation (rad, about 45 degrees) for full steering lock
const wheelCss = `
#wheelPad{position:fixed;inset:0;z-index:20;display:none;gap:10px;
  grid-template-columns:minmax(120px,30vw) 1fr minmax(120px,30vw);grid-template-rows:1fr 1.6fr;
  grid-template-areas:"hb mid gas" "brk mid gas";
  padding:calc(10px + env(safe-area-inset-top,0px)) calc(10px + env(safe-area-inset-right,0px)) calc(10px + env(safe-area-inset-bottom,0px)) calc(10px + env(safe-area-inset-left,0px));
  background:radial-gradient(120% 90% at 50% 0%,#16232b 0%,var(--ink) 70%);touch-action:none}
#wheelPad.touchsteer{grid-template-rows:2fr 1fr;grid-template-areas:"steer mid gas" "hb mid brk"}
body.pad #wheelPad{display:grid}
body.pad #intro,body.pad #touch,body.pad .hud{display:none!important}
#pHb{grid-area:hb}#pBrk{grid-area:brk}#pGas{grid-area:gas}#pSteer{grid-area:steer;display:none}#wheelPad .mid{grid-area:mid}
#wheelPad.touchsteer #pSteer{display:block}
#wheelPad button,#pSteer{font-family:var(--display);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text);
  background:var(--panel);border:1px solid var(--line);border-radius:10px;touch-action:none;-webkit-tap-highlight-color:transparent;min-height:0}
#wheelPad .pedal{font-size:22px;position:relative;overflow:hidden}
#wheelPad .pedal i{position:absolute;left:0;right:0;bottom:0;height:0;background:var(--accent);opacity:.85;pointer-events:none}
#wheelPad #pBrk i{background:var(--hot)}
#wheelPad .pedal span{position:relative}
#wheelPad #pHb.on{background:var(--accent);color:#1a1206}
#pSteer{position:relative;overflow:hidden}
#pSteer span{position:absolute;inset:auto 0 10px;text-align:center;font-size:13px;color:var(--dim);pointer-events:none}
#pSteer i{position:absolute;top:50%;left:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:var(--accent);opacity:.9;pointer-events:none}
#pSteer b{position:absolute;top:50%;left:12%;right:12%;height:2px;background:var(--line);pointer-events:none}
#wheelPad .mid{display:grid;gap:8px;grid-template-rows:auto 1fr auto;justify-items:center;text-align:center;min-height:0}
#wheelPad .stat{font-size:11px;color:var(--dim);max-width:36ch;line-height:1.45}
#wheelPad .stat b{color:var(--good);font-weight:500}
#wheelPad .ring{position:relative;height:100%;max-height:170px;aspect-ratio:1;min-height:0;align-self:center}
#wheelPad svg{width:100%;height:100%;display:block}
#wheelPad .spd{position:absolute;inset:0;display:grid;place-content:center;font-family:var(--display);font-weight:800;font-style:italic;font-size:34px;line-height:.9}
#wheelPad .spd small{font-family:var(--mono);font-style:normal;font-weight:400;font-size:10px;color:var(--dim);letter-spacing:.14em}
#wheelPad .btns{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
#wheelPad .btns button{font-size:13px;padding:6px 10px;min-height:38px}
#padGo{justify-self:start;font-family:var(--display);font-weight:700;font-size:16px;letter-spacing:.06em;text-transform:uppercase;background:transparent;color:var(--text);
  border:1px solid var(--line);border-radius:4px;padding:8px 18px;cursor:pointer}
body.touch #intro .ctl{display:none}
#intro{overflow-y:auto;align-items:safe center}
@media (max-height:520px){#intro .card{gap:10px;padding-block:12px}#intro .card h1{font-size:40px}}
.phoneTip{font-size:12px!important}
.phoneTip b{color:var(--text);font-weight:500}
.pairRow{display:flex;gap:14px;align-items:center}
#qr{flex:none;padding:6px;background:#ece2d0;border-radius:4px;line-height:0}
#qr img,#qr canvas{display:block}
.phoneTip .code{color:var(--accent);font-size:15px;letter-spacing:.12em}
`;
document.head.insertAdjacentHTML('beforeend', '<style>' + wheelCss + '</style>');
document.body.insertAdjacentHTML('beforeend', `
<div id="wheelPad" aria-label="Phone steering wheel">
  <div id="pSteer" aria-label="Steering pad"><b></b><i></i><span>Slide to steer</span></div>
  <button id="pHb">Hand<br>brake</button>
  <button id="pBrk" class="pedal"><i></i><span>Brake</span></button>
  <div class="mid">
    <div class="stat" id="padStat">Connecting…</div>
    <div class="ring"><svg viewBox="-50 -50 100 100" aria-hidden="true"><g id="padWheel" fill="none" stroke="currentColor">
      <circle r="44" stroke-width="7" stroke="rgba(236,226,208,.8)"/><path d="M-41 4 H-25 M25 4 H41 M0 27 V42" stroke-width="7" stroke="rgba(236,226,208,.55)"/>
      <path d="M-6 -44 H6" stroke-width="8" stroke="#f2a93b"/></g></svg>
      <div class="spd"><span id="padSpd">–</span><small>km/h</small></div></div>
    <div class="btns"><button id="pMode">Touch steer</button><button id="pCtr">Centre</button><button id="pCam">Camera</button><button id="pRst">Reset</button><button id="pExit">Exit</button></div>
  </div>
  <button id="pGas" class="pedal"><i></i><span>Gas</span></button>
</div>`);

/* Link between the two pages. Inside claude.ai it is the artifact's room (presence); on a hosted copy
   (no window.claude) it is a direct WebRTC data channel through PeerJS, paired by a 4-digit code that the
   computer shows (also as a QR code linking to ?pair=CODE). Both give the same calls:
   sendWheel/sendCar push absolute state, wheel()/car() return the newest {d, at, id} from the other end. */
const HOSTED = !(window.claude && window.claude.use);
const PAIR_PREFIX = 'ridgeline-drive-';
const link = { ok: false, err: '', code: '', lastW: null, lastC: null, conns: [] };
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
function linkInit(role) {
  if (link.role) return; link.role = role;
  if (!HOSTED) {
    (async () => {
      let room = null;
      try { room = await window.claude.use('room'); } catch (e) {}
      if (!room) { link.err = 'Can’t reach the game from this page. Make sure you’re signed in.'; return; }
      link.room = room; link.ok = true;
      link.sendWheel = w => room.presence({ wheel: w }).catch(() => {});
      link.sendCar = c => room.presence({ car: c }).catch(() => {});
      const newest = key => { let best = null; for (const p of room.peers()) { const v = p.presence && p.presence[key]; if (p.isMe && !p.sameTab && v && typeof v === 'object' && (!best || p.updatedAt > best.at)) best = { d: v, at: p.updatedAt, id: p.peer }; } return best; };
      link.wheel = () => newest('wheel'); link.car = () => newest('car');
      link.dropWheel = () => room.presence({ wheel: null }).catch(() => {});
    })();
    return;
  }
  link.wheel = () => link.lastW; link.car = () => link.lastC;
  link.sendWheel = w => { for (const c of link.conns) if (c.open) c.send({ w }); };
  link.sendCar = c => { for (const k of link.conns) if (k.open) k.send({ c }); };
  link.dropWheel = () => { for (const c of link.conns) c.close(); link.conns = []; };
  const onConn = c => {
    link.conns.push(c);
    c.on('open', () => { link.stage = 'open'; if (role === 'game') { toast('Phone linked'); const t = document.getElementById('pairTip'); if (t) t.insertAdjacentHTML('beforeend', ' <b class="code">Phone linked.</b>'); } });
    c.on('error', e => { link.lastConnErr = String(e && (e.type || e.message) || e); });
    c.on('data', m => { if (m && m.w) link.lastW = { d: m.w, at: Date.now(), id: c.peer }; if (m && m.c) link.lastC = { d: m.c, at: Date.now(), id: c.peer }; });
    c.on('close', () => { link.conns = link.conns.filter(k => k !== c); });
  };
  link.onConn = onConn;
  loadScript('https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js').then(() => {
    if (role === 'game') {
      const open = () => {
        link.code = String(1000 + Math.floor(Math.random() * 9000));
        const peer = new Peer(PAIR_PREFIX + link.code); link.peer = peer;
        peer.on('open', () => { link.ok = true; showPairing(); });
        peer.on('connection', onConn);
        peer.on('error', e => { if (e.type === 'unavailable-id') { peer.destroy(); open(); } else { link.err = 'Pairing server unreachable (' + e.type + ').'; showPairing(); } });
        peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
      };
      open();
    } else {
      link.peer = new Peer();
      link.peer.on('open', () => { link.ok = true; });
      link.peer.on('error', e => { link.err = e.type === 'peer-unavailable' ? 'No game with code ' + link.code + '. Check the code on your computer.' : 'Pairing failed (' + e.type + ').'; });
    }
  }).catch(() => { link.err = 'Couldn’t load the pairing library.'; showPairing(); });
}
// Phone, hosted: connect to the game with this code (retries until the peer is open).
// If the data channel hasn't opened after 7 s, drop it and dial again; after 4 tries, say so.
function linkConnect(code) {
  link.code = code; link.err = ''; link.stage = 'server'; let tries = 0;
  const go = () => {
    if (!link.peer || !link.ok) return setTimeout(go, 200);
    if (link.err) return;
    link.dropWheel(); tries++; link.stage = 'dial';
    const c = link.peer.connect(PAIR_PREFIX + code);
    link.onConn(c);
    setTimeout(() => {
      if (c.open || !padMode) return;
      if (tries < 4) go();
      else link.err = 'The phone found the game but couldn’t open a direct link to it' + (link.lastConnErr ? ' (' + link.lastConnErr + ')' : '') + '. Try putting both on the same Wi-Fi, then tap Exit and pair again.';
    }, 7000);
  };
  go();
}
const urlPair = (location.search.match(/[?&]pair=(\d{4})/) || [])[1] || '';

// Intro card: the phone gets a "Steering wheel" button, the computer a line saying how to pair.
{
  const card = document.querySelector('#intro .card'), go = document.getElementById('go');
  const tip = document.createElement('p'); tip.className = 'phoneTip'; tip.id = 'pairTip';
  if (document.body.classList.contains('touch')) {
    const b = document.createElement('button'); b.id = 'padGo'; b.textContent = 'Use this phone as a steering wheel';
    card.insertBefore(b, go.nextSibling); b.addEventListener('click', enterPad);
    tip.innerHTML = HOSTED ? 'Got the game open on a computer? Tap <b>steering wheel</b>' + (urlPair ? ' to pair with code <b>' + urlPair + '</b>.' : ' and type the code it shows.')
      : 'Got the game open on a computer too? Tap <b>steering wheel</b> to drive it from here.';
    card.insertBefore(tip, b);
  } else {
    tip.innerHTML = HOSTED ? '<b>Phone as a wheel:</b> getting a pairing code…'
      : '<b>Phone as a wheel:</b> open this same link on your phone, signed in to the same account, and tap <b>Use this phone as a steering wheel</b>.';
    card.insertBefore(tip, go);
    linkInit('game');
  }
}
function showPairing() {
  const tip = document.getElementById('pairTip'); if (!tip) return;
  if (link.err) { tip.innerHTML = '<b>Phone as a wheel:</b> ' + link.err; return; }
  const url = location.origin + location.pathname + '?pair=' + link.code;
  tip.innerHTML = '<span class="pairRow"><span id="qr"></span><span><b>Phone as a wheel:</b> scan this with your phone, or open this page on it and enter code <b class="code">' + link.code + '</b>. Then tap <b>Use this phone as a steering wheel</b>.</span></span>';
  const draw = () => new QRCode(document.getElementById('qr'), { text: url, width: 96, height: 96, colorDark: '#0b1216', colorLight: '#ece2d0' });
  (window.QRCode ? Promise.resolve() : loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js')).then(draw).catch(() => {});
  const keys = document.getElementById('keys'); if (keys && !document.getElementById('pairKey')) keys.insertAdjacentHTML('beforeend', '<span id="pairKey"><b>' + link.code + '</b>phone code</span>');
}

let wheelSeenId = null;
function wheelInput() {
  if (padMode || !link.ok) return null;
  const p = link.wheel(), now = performance.now();
  if (HOSTED && link.conns.length && now - lastCarPub > 250 && (!p || Date.now() - p.at > 1500)) { lastCarPub = now; link.sendCar({ k: 0, g: 'N', on: started }); }
  if (!p || Date.now() - p.at > 1500) {
    if (wheelSeenId && p) { wheelSeenId = null; toast('Phone wheel lost'); }
    return null;
  }
  const w = p.d, num = (v, a, b) => clamp(Number(v) || 0, a, b);
  if (wheelSeenId !== p.id) { wheelSeenId = p.id; wheelSeen = { r: w.r, c: w.c }; toast('Phone wheel connected'); }
  if (w.r !== wheelSeen.r) { wheelSeen.r = w.r; if (started) resetCar(); }
  if (w.c !== wheelSeen.c) { wheelSeen.c = w.c; if (started) camMode = (camMode + 1) % 3; }
  if (now - lastCarPub > 100) {
    lastCarPub = now;
    link.sendCar({ k: Math.round(Math.abs(car.fwdSpeed) * 3.6), g: car.reverse ? 'R' : String(car.gear), on: started });
  }
  return { s: num(w.s, -1, 1), g: num(w.g, 0, 1), b: num(w.b, 0, 1), h: w.h ? 1 : 0 };
}
// Audio can only start from a gesture on the computer itself; if the phone started the run, resume on the next one.
const resumeAudio = () => { if (audio && audio.ac.state === 'suspended') audio.ac.resume(); };
addEventListener('pointerdown', resumeAudio); addEventListener('keydown', resumeAudio);

/* ---- phone side ---- */
const pad = { s: 0, g: 0, b: 0, h: 0, r: 0, c: 0, a0: null, a: 0, gx: 0, gy: 0, sensor: false, touch: false, picked: false, why: '', beat: 0, tilt: 0 };
const padEl = document.getElementById('wheelPad');
function setTouchSteer(on) {
  pad.touch = on; padEl.classList.toggle('touchsteer', on);
  document.getElementById('pMode').textContent = on ? 'Tilt steer' : 'Touch steer';
  if (!on) pad.a0 = null; pad.s = 0;
}
async function enterPad() {
  // iOS asks for motion access, and only from a tap.
  pad.why = '';
  for (const E of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) {
    try { if (E && E.requestPermission && (await E.requestPermission()) !== 'granted') pad.why = 'denied'; } catch (e) { pad.why = 'denied'; }
  }
  const pol = document.permissionsPolicy || document.featurePolicy;
  try { if (pol && pol.allowsFeature && !(pol.allowsFeature('accelerometer') && pol.allowsFeature('gyroscope'))) pad.why = 'blocked'; } catch (e) {}
  if (HOSTED) {
    const code = urlPair || (prompt('Enter the 4-digit code shown on your computer') || '').replace(/\D/g, '');
    if (!/^\d{4}$/.test(code)) return;
    linkInit('wheel'); linkConnect(code);
  } else linkInit('wheel');
  padMode = true; document.body.classList.add('pad');
  addEventListener('devicemotion', onMotion); addEventListener('deviceorientation', onOrient);
  try { await document.documentElement.requestFullscreen?.(); await screen.orientation?.lock?.('landscape'); } catch (e) {}
  try { pad.wake = await navigator.wakeLock?.request('screen'); } catch (e) {}
  setTouchSteer(!!pad.why);
  setTimeout(() => { if (padMode && !pad.sensor && !pad.picked) { if (!pad.why) pad.why = 'silent'; setTouchSteer(true); } }, 1500);
  requestAnimationFrame(padFrame);
}
function exitPad() {
  padMode = false; document.body.classList.remove('pad');
  removeEventListener('devicemotion', onMotion); removeEventListener('deviceorientation', onOrient);
  try { pad.wake?.release(); document.fullscreenElement && document.exitFullscreen(); } catch (e) {}
  link.dropWheel?.();
}
// Both sensor events reduce to the gravity direction in the screen plane; the wheel angle is the phone's roll
// about its screen normal, measured from where it was held at start (or when Centre is tapped).
function tiltFrom(gx, gy) {
  pad.gx += (gx - pad.gx) * 0.35; pad.gy += (gy - pad.gy) * 0.35;
  if (Math.hypot(pad.gx, pad.gy) < 0.25) return;   // phone lying too flat to read a roll; keep the last angle
  if (!pad.sensor) { pad.sensor = true; if (pad.why === 'silent') pad.why = ''; if (!pad.picked && pad.touch && !pad.why) setTouchSteer(false); }
  pad.a = Math.atan2(pad.gy, pad.gx);
  if (pad.a0 === null) pad.a0 = pad.a;
  let d = pad.a - pad.a0; d = Math.atan2(Math.sin(d), Math.cos(d));
  const dz = 0.03; d = Math.sign(d) * Math.max(0, Math.abs(d) - dz);
  pad.tilt = clamp(d / (WHEEL_LOCK - dz), -1, 1);
  if (!pad.touch) pad.s = pad.tilt;
}
function onMotion(e) {
  const g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
  pad.lastMotion = performance.now(); tiltFrom(g.x / 9.81, g.y / 9.81);
}
function onOrient(e) {
  if (e.beta == null || performance.now() - (pad.lastMotion || -1e9) < 500) return;   // prefer devicemotion when both arrive
  const b = e.beta * Math.PI / 180, c = e.gamma * Math.PI / 180;
  tiltFrom(-Math.cos(b) * Math.sin(c), Math.sin(b));
}
function padFrame(now) {
  if (!padMode) return;
  requestAnimationFrame(padFrame);
  if (now - pad.beat > 300) pad.beat = now;
  const r2 = v => Math.round(v * 100) / 100;
  if (link.ok) link.sendWheel({ s: r2(pad.s), g: r2(pad.g), b: r2(pad.b), h: pad.h, r: pad.r, c: pad.c, t: Math.round(pad.beat) });
  document.getElementById('padWheel').setAttribute('transform', 'rotate(' + (pad.s * WHEEL_LOCK * 57.3).toFixed(1) + ')');
  document.querySelector('#pGas i').style.height = (pad.g * 100) + '%';
  document.querySelector('#pBrk i').style.height = (pad.b * 100) + '%';
  const gp = link.ok && link.car(), game = gp && Date.now() - gp.at < 3000 ? gp.d : null;
  const why = { blocked: 'this page isn’t allowed to read the tilt sensor', denied: 'motion access was refused', silent: 'no tilt readings reached this page' }[pad.why];
  const how = pad.touch ? (why ? 'Touch steering: ' + why + '.' : 'Touch steering.') : 'Tilt to steer.';
  const msg = link.err ? link.err
    : !link.ok || !game ? (!HOSTED ? 'Open the game on your computer with the same account. It links up on its own.'
      : !link.ok ? 'Step 1 of 3: reaching the pairing server…'
      : link.stage !== 'open' ? 'Step 2 of 3: connecting to the game with code ' + link.code + '…'
      : 'Step 3 of 3: linked, waiting for the game to answer. Keep the game tab open on the computer.')
    : (!game.on ? '<b>Linked.</b> Press Gas to start. ' : '<b>Linked</b> · gear ' + String(game.g).slice(0, 2) + '. ') + how;
  if (padEl.dataset.m !== msg) { padEl.dataset.m = msg; document.getElementById('padStat').innerHTML = msg; }
  document.getElementById('padSpd').textContent = game ? Number(game.k) || 0 : '–';
}
// Pedals: analog by how high the finger sits on the button (top = full), never below 40% once pressed.
for (const [id, k] of [['pGas', 'g'], ['pBrk', 'b']]) {
  const el = document.getElementById(id);
  const set = e => { e.preventDefault(); const r = el.getBoundingClientRect(); pad[k] = clamp(0.4 + 0.75 * (1 - (e.clientY - r.top) / r.height), 0.4, 1); };
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); set(e); });
  el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) set(e); });
  for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => { pad[k] = 0; });
}
{
  const hb = document.getElementById('pHb');
  const on = v => e => { e.preventDefault(); pad.h = v; hb.classList.toggle('on', !!v); };
  hb.addEventListener('pointerdown', on(1)); hb.addEventListener('pointerup', on(0)); hb.addEventListener('pointercancel', on(0)); hb.addEventListener('pointerleave', on(0));
  document.getElementById('pRst').addEventListener('click', () => { pad.r++; });
  document.getElementById('pCam').addEventListener('click', () => { pad.c++; });
  document.getElementById('pCtr').addEventListener('click', () => { pad.a0 = pad.a; pad.tilt = 0; if (!pad.touch) pad.s = 0; });
  document.getElementById('pMode').addEventListener('click', () => { pad.picked = true; setTouchSteer(!pad.touch); });
  document.getElementById('pExit').addEventListener('click', exitPad);
  // Thumb pad: slide sideways from wherever the thumb lands; full lock at 40% of the pad's width. Lets go to centre.
  const st = document.getElementById('pSteer'), knob = st.querySelector('i');
  let x0 = 0;
  const move = e => { const r = st.getBoundingClientRect(); pad.s = clamp((e.clientX - x0) / (r.width * 0.4), -1, 1); knob.style.left = (50 + pad.s * 38) + '%'; };
  st.addEventListener('pointerdown', e => { e.preventDefault(); st.setPointerCapture(e.pointerId); x0 = e.clientX; move(e); });
  st.addEventListener('pointermove', e => { if (st.hasPointerCapture(e.pointerId)) move(e); });
  for (const ev of ['pointerup', 'pointercancel']) st.addEventListener(ev, () => { if (pad.touch) pad.s = 0; knob.style.left = '50%'; });
}
