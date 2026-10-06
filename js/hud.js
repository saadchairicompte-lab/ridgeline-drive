// Ridgeline Drive: Speed and rpm gauge, minimap, toasts, lap timing and drift scoring.
// Classic script: top-level declarations are shared with the other files, loaded in the order index.html lists them.
'use strict';
/* ================= HUD ================= */
const $ = id => document.getElementById(id);
const hud = { abs: $('lampAbs'), tcs: $('lampTcs'), lap: $('lapTime'), best: $('best'), last: $('lastLap'), dt: $('driftTotal'), dn: $('driftNow'), spd: $('spd'), gear: $('gear'), toast: $('toast') };
const COLS = { text: css('--text'), dim: css('--dim'), accent: css('--accent'), hot: css('--hot'), line: css('--line'), panel: css('--panel') };
const fmt = s => { if (s == null || !(s >= 0)) return '--'; const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(3); };
let toastT = 0;
function toast(msg) { hud.toast.textContent = msg; hud.toast.classList.add('on'); toastT = 2.2; }
const gauge = $('gauge'), gctx = gauge.getContext('2d'), mapC = $('map'), mctx = mapC.getContext('2d');
function fitCanvas(c) { const r = c.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2); c.width = Math.round(r.width * d) || c.width; c.height = Math.round(r.height * d) || c.height; }
function drawGauge() {
  const c = gctx, S = gauge.width, cx = S / 2, cy = S / 2, R = S * 0.43, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, A = v => a0 + (a1 - a0) * v / 8000;
  c.clearRect(0, 0, S, S);
  c.beginPath(); c.arc(cx, cy, R + S * 0.04, 0, TAU); c.fillStyle = COLS.panel; c.fill(); c.lineWidth = 1; c.strokeStyle = COLS.line; c.stroke();
  c.lineCap = 'butt'; c.lineWidth = S * 0.03;
  c.beginPath(); c.arc(cx, cy, R, a0, a1); c.strokeStyle = 'rgba(236,226,208,.12)'; c.stroke();
  c.beginPath(); c.arc(cx, cy, R, A(6800), a1); c.strokeStyle = COLS.hot; c.stroke();
  c.beginPath(); c.arc(cx, cy, R, a0, A(Math.min(car.rpm, 8000))); c.strokeStyle = car.rpm > 6800 ? COLS.hot : COLS.accent; c.stroke();
  c.fillStyle = COLS.dim; c.font = `500 ${S * 0.055}px 'IBM Plex Mono', monospace`; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let k = 0; k <= 8; k++) {
    const a = A(k * 1000), ca = Math.cos(a), sa = Math.sin(a);
    c.strokeStyle = k >= 7 ? COLS.hot : COLS.text; c.lineWidth = S * 0.008;
    c.beginPath(); c.moveTo(cx + ca * (R - S * 0.035), cy + sa * (R - S * 0.035)); c.lineTo(cx + ca * (R - S * 0.075), cy + sa * (R - S * 0.075)); c.stroke();
    c.fillText(k, cx + ca * (R - S * 0.12), cy + sa * (R - S * 0.12));
  }
}
let mapPath = null;
function drawMap() {
  const c = mctx, S = mapC.width, sc = S / 170 * 0.07;
  if (!mapPath) { mapPath = new Path2D(); const { xs, zs, N } = road; mapPath.moveTo(xs[0], zs[0]); for (let i = 1; i < N; i++) mapPath.lineTo(xs[i], zs[i]); mapPath.closePath(); }
  const yaw = Math.atan2(fwd.x, fwd.z);
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, S, S);
  c.save(); c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 1, 0, TAU); c.clip();
  c.translate(S / 2, S / 2); c.rotate(Math.PI + yaw); c.scale(-sc, sc); c.translate(-car.pos.x, -car.pos.z);
  c.lineJoin = 'round'; c.strokeStyle = 'rgba(236,226,208,.8)'; c.lineWidth = 3 / sc * (S / 170); c.stroke(mapPath);
  c.fillStyle = COLS.accent; c.beginPath(); c.arc(road.xs[0], road.zs[0], 5 / sc * (S / 170), 0, TAU); c.fill();
  c.restore();
  c.setTransform(1, 0, 0, 1, S / 2, S / 2); const k = S / 170;
  c.fillStyle = COLS.hot; c.beginPath(); c.moveTo(0, -8 * k); c.lineTo(5 * k, 6 * k); c.lineTo(0, 3 * k); c.lineTo(-5 * k, 6 * k); c.closePath(); c.fill();
  c.setTransform(1, 0, 0, 1, 0, 0);
}


/* ================= lap timing + drift scoring ================= */
const lap = { armed: false, start: 0, half: false, lastProg: -1, best: null, last: null, now: 0 };
try { const b = parseFloat(localStorage.getItem('ridgeline-best')); if (b > 0) lap.best = b; } catch (e) {}
const drift = { cur: 0, timer: 0, total: 0 };
let clock = 0;
function onCrash() { if (drift.cur > 50) { drift.cur = 0; drift.timer = 0; toast('Drift lost'); } }
function updateLap(dt) {
  roadQuery(car.pos.x, car.pos.z);
  if (RQ.d < 30) {
    const prog = (RQ.i + RQ.t) / road.N;
    if (lap.lastProg >= 0) {
      if (lap.lastProg > 0.9 && prog < 0.1) {
        if (lap.armed && lap.half) {
          const t = clock - lap.start; lap.last = t;
          if (!lap.best || t < lap.best) { lap.best = t; toast('New best lap ' + fmt(t)); try { localStorage.setItem('ridgeline-best', String(t)); } catch (e) {} }
          else toast('Lap ' + fmt(t));
        } else if (!lap.armed) toast('Lap started');
        lap.armed = true; lap.half = false; lap.start = clock;
      } else if (lap.lastProg < 0.1 && prog > 0.9) { lap.armed = false; }
      if (prog > 0.45 && prog < 0.55) lap.half = true;
    }
    lap.lastProg = prog;
  }
  const beta = Math.abs(Math.atan2(car.vel.dot(left), car.vel.dot(fwd)));
  if (car.grounded >= 3 && car.speed > 9 && car.fwdSpeed > 0 && beta > 0.2 && beta < 1.7) { drift.cur += dt * car.speed * beta * 12; drift.timer = 0.9; }
  drift.timer -= dt;
  if (drift.timer <= 0 && drift.cur > 0) { const p = Math.round(drift.cur); if (p > 50) { drift.total += p; toast('+' + p + ' drift'); } drift.cur = 0; }
}

// ABS / TCS lamps: lit while the aid is working, struck through when aids are switched off (T)
function updateLamps() {
  const a = car.assist || {};
  hud.abs.className = a.abs === false ? 'off' : car.absActive ? 'on' : '';
  hud.tcs.className = a.tcs === false ? 'off' : car.tcsActive ? 'on' : '';
}
