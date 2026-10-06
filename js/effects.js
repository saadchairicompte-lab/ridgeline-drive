// Ridgeline Drive: Tyre smoke, dust and water-splash particles, and fading skid marks.
// Classic script: top-level declarations are shared with the other files, loaded in the order index.html lists them.
'use strict';
/* ================= particles: tyre smoke, dust, water spray ================= */
const SMOKE_N = 900;
const smoke = {
  p: new Float32Array(SMOKE_N * 3), v: new Float32Array(SMOKE_N * 3), life: new Float32Array(SMOKE_N), max: new Float32Array(SMOKE_N).fill(1),
  size: new Float32Array(SMOKE_N), alpha: new Float32Array(SMOKE_N), col: new Float32Array(SMOKE_N * 3), rot: new Float32Array(SMOKE_N),
  spin: new Float32Array(SMOKE_N), grav: new Float32Array(SMOKE_N), s0: new Float32Array(SMOKE_N), s1: new Float32Array(SMOKE_N), a0: new Float32Array(SMOKE_N), next: 0
};
const smokeGeo = new THREE.BufferGeometry();
smokeGeo.setAttribute('position', new THREE.BufferAttribute(smoke.p, 3).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('aSize', new THREE.BufferAttribute(smoke.size, 1).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('aAlpha', new THREE.BufferAttribute(smoke.alpha, 1).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('aCol', new THREE.BufferAttribute(smoke.col, 3).setUsage(THREE.DynamicDrawUsage));
smokeGeo.setAttribute('aRot', new THREE.BufferAttribute(smoke.rot, 1).setUsage(THREE.DynamicDrawUsage));
// soft, lumpy puff sprite so overlapping particles read as billowing smoke rather than discs
const puffTex = canvasTex(128, 128, (g, w, h) => {
  const r = makeRng(31);
  for (let i = 0; i < 26; i++) {
    const a = r() * TAU, d = Math.sqrt(r()) * 30, x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d, rad = 14 + r() * 22;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(255,255,255,${0.22 + r() * 0.2})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
  const im = g.getImageData(0, 0, w, h), d = im.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {   // round falloff so the sprite square never shows
    const i = (y * w + x) * 4, q = Math.hypot(x - w / 2 + 0.5, y - h / 2 + 0.5) / (w / 2);
    d[i + 3] = Math.min(255, d[i + 3] * 1.25) * ss(1, 0.55, q);
  }
  g.putImageData(im, 0, 0);
}, false);
puffTex.wrapS = puffTex.wrapT = THREE.ClampToEdgeWrapping;
const smokeMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, fog: true,
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 }, sunCol: { value: new THREE.Color(1, 0.94, 0.86) }, map: { value: null } }]),
  vertexShader: `attribute float aSize, aAlpha, aRot; attribute vec3 aCol; uniform float uScale; varying float vA, vRot; varying vec3 vC;
    #include <fog_pars_vertex>
    void main(){
      vec4 mvPosition = modelViewMatrix*vec4(position,1.0);
      float z = -mvPosition.z;
      gl_PointSize = aSize*uScale*projectionMatrix[1][1]/max(z, 0.2);
      // pull the sprite toward the camera by up to half its size so it doesn't slice into the ground
      mvPosition.xyz += normalize(-mvPosition.xyz) * min(min(aSize*0.3, 1.2), max(z - 0.6, 0.0));
      gl_Position = projectionMatrix*mvPosition;
      vA = aAlpha * smoothstep(0.6, 3.0, z); vC = aCol; vRot = aRot;
      #include <fog_vertex>
    }`,
  fragmentShader: `varying float vA, vRot; varying vec3 vC; uniform vec3 sunCol; uniform sampler2D map;
    #include <fog_pars_fragment>
    void main(){
      vec2 p = gl_PointCoord - 0.5; float c = cos(vRot), s = sin(vRot);
      vec2 q = vec2(c*p.x - s*p.y, s*p.x + c*p.y) + 0.5;
      float a = texture2D(map, q).a * vA; if (a < 0.004) discard;
      vec3 col = vC * sunCol * (0.78 + 0.4*(0.5 - p.y));   // lit from above, shaded underneath
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <encodings_fragment>
      #include <fog_fragment>
    }`
});
smokeMat.uniforms.map.value = puffTex;
const smokePts = new THREE.Points(smokeGeo, smokeMat); smokePts.frustumCulled = false; smokePts.renderOrder = 2; scene.add(smokePts);

const SMOKE_COL = [0.88, 0.89, 0.92], DUST_COL = [0.58, 0.49, 0.37], SPRAY_COL = [0.86, 0.92, 0.96];
function spawn(x, y, z, vx, vy, vz, life, s0, s1, a0, grav, col) {
  const i = smoke.next; smoke.next = (i + 1) % SMOKE_N;
  smoke.p[i * 3] = x; smoke.p[i * 3 + 1] = y; smoke.p[i * 3 + 2] = z;
  smoke.v[i * 3] = vx; smoke.v[i * 3 + 1] = vy; smoke.v[i * 3 + 2] = vz;
  smoke.life[i] = smoke.max[i] = life; smoke.s0[i] = s0; smoke.s1[i] = s1; smoke.a0[i] = a0; smoke.grav[i] = grav;
  smoke.rot[i] = Math.random() * TAU; smoke.spin[i] = (Math.random() - 0.5) * 1.2;
  const b = 0.94 + Math.random() * 0.1; smoke.col[i * 3] = col[0] * b; smoke.col[i * 3 + 1] = col[1] * b; smoke.col[i * 3 + 2] = col[2] * b;
}
function emitSmoke(pos, base, dust) {
  const rx = (Math.random() - 0.5) * 0.4, rz = (Math.random() - 0.5) * 0.4;
  if (pos.y < WATER - 0.02) return;   // wheels under water throw spray instead (emitSpray)
  if (dust) spawn(pos.x + rx, pos.y + 0.25, pos.z + rz, base.x * 0.35 + (Math.random() - 0.5) * 2, 0.5 + Math.random() * 0.9, base.z * 0.35 + (Math.random() - 0.5) * 2,
    1.0 + Math.random() * 0.8, 0.6, 3 + Math.random() * 1.5, 0.38, 0.25, DUST_COL);
  else spawn(pos.x + rx, pos.y + 0.3, pos.z + rz, base.x * 0.22 + (Math.random() - 0.5) * 1.6, 0.6 + Math.random() * 1.1, base.z * 0.22 + (Math.random() - 0.5) * 1.6,
    1.6 + Math.random() * 1.1, 0.5, 3.6 + Math.random() * 2, 0.34, 0, SMOKE_COL);
}
// water: spray from wheels running through the shallows, and a bow splash when the body ploughs in
let sprayAcc = 0;
function emitSpray(dt) {
  if (typeof car === 'undefined' || car.speed < 2.5) return;
  sprayAcc += dt * Math.min(car.speed, 30) * 1.4;
  while (sprayAcc >= 1) {
    sprayAcc -= 1;
    for (const S of car.wheels) {
      if (!S.hit || S.contact.y > WATER - 0.02) continue;
      const u = 0.4 + Math.random() * 0.5;
      spawn(S.contact.x, WATER + 0.05, S.contact.z, car.vel.x * 0.4 + (Math.random() - 0.5) * 3, 2 + Math.random() * 3.5 * u, car.vel.z * 0.4 + (Math.random() - 0.5) * 3,
        0.6 + Math.random() * 0.4, 0.3, 1.1 + Math.random() * 0.6, 0.55, 9.8, SPRAY_COL);
    }
    if (car.pos.y < WATER + 0.5 && car.speed > 4) {
      spawn(car.pos.x + car.vel.x * 0.12 + (Math.random() - 0.5) * 2, WATER + 0.1, car.pos.z + car.vel.z * 0.12 + (Math.random() - 0.5) * 2,
        car.vel.x * 0.6 + (Math.random() - 0.5) * 4, 3 + Math.random() * 3, car.vel.z * 0.6 + (Math.random() - 0.5) * 4, 0.8 + Math.random() * 0.4, 0.5, 1.6 + Math.random() * 1.0, 0.45, 9.8, SPRAY_COL);
    }
  }
}
function updateSmoke(dt) {
  emitSpray(dt);
  const { p, v, life, max, size, alpha, rot, spin, grav, s0, s1, a0 } = smoke;
  for (let i = 0; i < SMOKE_N; i++) {
    if (life[i] <= 0) { alpha[i] = 0; continue; }
    life[i] -= dt; const t = Math.max(0, 1 - life[i] / max[i]), j = i * 3;
    const drag = grav[i] > 5 ? 0.4 : 1.4;
    v[j] *= 1 - drag * dt; v[j + 2] *= 1 - drag * dt;
    v[j + 1] = grav[i] > 0 ? v[j + 1] - grav[i] * dt : v[j + 1] * (1 - dt) + 0.45 * dt;
    p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
    rot[i] += spin[i] * dt;
    const e = 1 - (1 - t) * (1 - t);                 // fast early growth, slowing as it disperses
    size[i] = s0[i] + (s1[i] - s0[i]) * e;
    alpha[i] = Math.min(t * 10, 1) * Math.pow(1 - t, 1.6) * a0[i];
  }
  const at = smokeGeo.attributes;
  at.position.needsUpdate = at.aSize.needsUpdate = at.aAlpha.needsUpdate = at.aCol.needsUpdate = at.aRot.needsUpdate = true;
  flushSkids();
}

/* ================= skid marks =================
   Ring buffer of quads. Darkness follows how hard the tyre was sliding, edges are soft with tread grooves,
   the oldest marks fade out before they are overwritten, and off-road the tyres leave brown ruts. */
const SKID_N = 4000;
const skidPos = new Float32Array(SKID_N * 18), skidX = new Float32Array(SKID_N * 6), skidA = new Float32Array(SKID_N * 6),
  skidSeg = new Float32Array(SKID_N * 6), skidDirt = new Float32Array(SKID_N * 6);
for (let s = 0; s < SKID_N; s++) { skidSeg.fill(s, s * 6, s * 6 + 6); skidX.set([1, 1, 0, 0, 1, 0], s * 6); }
const skidGeo = new THREE.BufferGeometry();
skidGeo.setAttribute('position', new THREE.BufferAttribute(skidPos, 3).setUsage(THREE.DynamicDrawUsage));
skidGeo.setAttribute('aX', new THREE.BufferAttribute(skidX, 1));
skidGeo.setAttribute('aA', new THREE.BufferAttribute(skidA, 1).setUsage(THREE.DynamicDrawUsage));
skidGeo.setAttribute('aSeg', new THREE.BufferAttribute(skidSeg, 1));
skidGeo.setAttribute('aDirt', new THREE.BufferAttribute(skidDirt, 1).setUsage(THREE.DynamicDrawUsage));
const skidMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uHead: { value: 0 }, uN: { value: SKID_N } }]),
  vertexShader: `attribute float aX, aA, aSeg, aDirt; uniform float uHead, uN; varying float vX, vA, vDirt;
    #include <fog_pars_vertex>
    void main(){
      float age = mod(uHead - aSeg - 1.0 + uN, uN) / uN;
      vA = aA * (1.0 - smoothstep(0.7, 1.0, age)); vX = aX; vDirt = aDirt;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `varying float vX, vA, vDirt;
    #include <fog_pars_fragment>
    void main(){
      float edge = smoothstep(0.0, 0.2, vX) * smoothstep(1.0, 0.8, vX);
      float tread = 0.72 + 0.28 * smoothstep(0.15, 0.35, abs(fract(vX * 4.0) - 0.5));
      float a = vA * edge * mix(tread, 1.0, vDirt);
      if (a < 0.003) discard;
      gl_FragColor = vec4(mix(vec3(0.018, 0.018, 0.02), vec3(0.16, 0.11, 0.07), vDirt), a);
      #include <tonemapping_fragment>
      #include <encodings_fragment>
      #include <fog_fragment>
    }`
});
const skidMesh = new THREE.Mesh(skidGeo, skidMat);
skidMesh.frustumCulled = false; skidMesh.renderOrder = 1; scene.add(skidMesh);
let skidNext = 0, skidLo = 1e9, skidHi = -1;
const skA = new V3(), skB = new V3();
function addSkid(S, side) {
  skA.copy(S.contact).addScaledVector(S.n, 0.03).addScaledVector(side, 0.12);
  skB.copy(S.contact).addScaledVector(S.n, 0.03).addScaledVector(side, -0.12);
  const dirt = S.onRoad ? 0 : 1, a = (S.onRoad ? 0.4 + Math.min((S.slip - 0.35) * 0.6, 0.45) : 0.35 + Math.min((S.slip - 0.35) * 0.3, 0.25));
  if (S.mark && S.mark[0].distanceToSquared(skA) < 16) {
    const [pa, pb] = S.mark, s = skidNext, o = s * 6, pA = S.markA ?? a;
    skidPos.set([pa.x, pa.y, pa.z, skA.x, skA.y, skA.z, pb.x, pb.y, pb.z, pb.x, pb.y, pb.z, skA.x, skA.y, skA.z, skB.x, skB.y, skB.z], s * 18);
    skidA.set([pA, a, pA, pA, a, a], o); skidDirt.fill(dirt, o, o + 6);
    skidLo = Math.min(skidLo, s); skidHi = Math.max(skidHi, s);
    skidNext = (s + 1) % SKID_N;
    pa.copy(skA); pb.copy(skB);
  } else S.mark = [skA.clone(), skB.clone()];
  S.markA = a;
}
// upload only the segments written since the last draw (the dirty range resets once the mesh has been drawn)
function flushSkids() {
  skidMat.uniforms.uHead.value = skidNext;
  if (skidHi < 0) return;
  const at = skidGeo.attributes;
  for (const [attr, n] of [[at.position, 18], [at.aA, 6], [at.aDirt, 6]]) {
    attr.updateRange.offset = skidLo * n; attr.updateRange.count = (skidHi - skidLo + 1) * n; attr.needsUpdate = true;
  }
}
skidMesh.onAfterRender = () => { skidLo = 1e9; skidHi = -1; };
