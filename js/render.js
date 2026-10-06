// Ridgeline Drive: Renderer, scene, sky shader, sun-aware height fog, lights, shadows, environment map and procedural textures (grain, road, water).
// Classic script: top-level declarations are shared with the other files, loaded in the order index.html lists them.
'use strict';
/* ================= renderer / scene ================= */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// capped at 1.5: above that the extra pixels cost far more than they show; lowered further at runtime if frames run slow
const PR_MAX = Math.min(devicePixelRatio || 1, 1.5), PR_MIN = Math.min(PR_MAX, 0.6);
renderer.setPixelRatio(PR_MAX);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);

// late-afternoon sun: low enough for long shadows and a warm glow on the haze
const SUN_EL = 0.42, SUN_AZ = -0.9;
const sunDir = new V3(Math.cos(SUN_EL) * Math.cos(SUN_AZ), Math.sin(SUN_EL), Math.cos(SUN_EL) * Math.sin(SUN_AZ)).normalize();
const HORIZON = C(0xc4d2dc), ZENITH = C(0x2c5f9e);
scene.fog = new THREE.FogExp2(HORIZON, 0.0022);

/* ================= fog: height falloff + sun scattering =================
   Replaces three's fog chunks for every material. Fog is denser in the valleys and thinner up high, and takes
   the same warm glow toward the sun as the sky, so distant hills melt into the sky instead of into a flat grey. */
const glsl = v => `vec3(${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)})`;
const SUN_GLOW = 'vec3(0.62,0.40,0.20)', FOG_HB = '0.0065', FOG_H0 = '22.0';
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float fogDepth;\n\tvarying vec3 vFogRel;\n#endif';
// camera-relative world vector: transpose(mat3(viewMatrix)) * mvPosition, written out for GLSL ES 1.0
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  fogDepth = - mvPosition.z;
  vFogRel = vec3(dot(viewMatrix[0].xyz, mvPosition.xyz), dot(viewMatrix[1].xyz, mvPosition.xyz), dot(viewMatrix[2].xyz, mvPosition.xyz));
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying float fogDepth; varying vec3 vFogRel;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  float fogDist = length(vFogRel);
  vec3 fogV = vFogRel / max(fogDist, 1e-4);
  #ifdef FOG_EXP2
    float fogDy = vFogRel.y * ${FOG_HB};
    float fogH = exp(-${FOG_HB} * (cameraPosition.y - ${FOG_H0})) * (abs(fogDy) > 1e-4 ? (1.0 - exp(-fogDy)) / fogDy : 1.0);
    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * fogDist * fogDist * clamp(fogH, 0.18, 2.2));
  #else
    float fogFactor = smoothstep(fogNear, fogFar, fogDist);
  #endif
  vec3 fogC = fogColor + ${SUN_GLOW} * pow(max(dot(fogV, ${glsl(sunDir)}), 0.0), 8.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogC, fogFactor);
#endif`;

/* ================= sky ================= */
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { sunDir: { value: sunDir }, top: { value: ZENITH }, horizon: { value: HORIZON }, ground: { value: C(0x8a969c) }, time: { value: 0 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform vec3 sunDir, top, horizon, ground; uniform float time; varying vec3 vDir;
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x), f.y); }
    float fbm5(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*vn(p); p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(1.7,9.2); a*=.5; } return s; }
    float fbm3(vec2 p){ float s=0., a=.5; for(int i=0;i<3;i++){ s+=a*vn(p); p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(1.7,9.2); a*=.5; } return s; }
    void main(){
      vec3 d = normalize(vDir); float y = d.y;
      float s = max(dot(d, sunDir), 0.);
      vec3 glow = ${SUN_GLOW} * pow(s, 8.);
      // Rayleigh-ish gradient: deep blue overhead, paler and slightly warmer near the horizon
      vec3 col = mix(horizon, top, pow(clamp(y, 0., 1.), .42));
      col += vec3(.05,.03,-.01) * pow(1. - clamp(y, 0., 1.), 6.);
      col = mix(col, ground, smoothstep(0.0, -0.3, y));
      col += glow + vec3(1.,.82,.6)*pow(s,60.)*.45 + vec3(1.,.92,.8)*pow(s,900.)*3.;
      col = mix(col, vec3(14.,12.,9.5), smoothstep(.99955,.99975,s));
      if (y > 0.) {
        float fade = smoothstep(0.012, .22, y);
        // cumulus: coverage from fbm, self-shadowing from a second sample stepped toward the sun
        vec2 uv = d.xz/(y+.12)*1.1 + vec2(time*.004, time*.0015);
        float n = fbm5(uv*1.5);
        float cov = smoothstep(.47, .8, n);
        float n2 = fbm3(uv*1.5 + normalize(sunDir.xz)*.18);
        float lit = clamp(.62 + (n - n2)*3.2, 0., 1.);
        vec3 cc = mix(vec3(.55,.6,.7), vec3(1.05,1.0,.95), lit);
        cc += vec3(1.,.78,.5) * pow(s, 5.) * (1. - cov) * 1.4;   // silver lining on thin edges near the sun
        col = mix(col, cc, cov*fade*.93);
        // high cirrus streaks
        vec2 cu = d.xz/(y+.04)*.3 + vec2(time*.006, time*.002);
        float ci = smoothstep(.52, .86, fbm3(vec2(cu.x*.7 + cu.y*.4, cu.y*3.2)));
        col += vec3(.95,.93,.9) * ci * .22 * fade * (1. - cov);
      }
      // haze band: exactly the fog colour at the horizon so terrain and sky meet without a seam
      col = mix(col, horizon + glow, exp(-max(y, 0.)*22.));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <encodings_fragment>
    }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), skyMat);
sky.frustumCulled = false; sky.renderOrder = -1;
scene.add(sky);
{
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  pm.dispose();
}

/* ================= lights ================= */
const sun = new THREE.DirectionalLight(C(0xffe6c8), 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 600 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(C(0xb4cdea), C(0x4f4b36), 0.32));


/* ================= procedural textures ================= */
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); if (srgb) t.encoding = THREE.sRGBEncoding; return t;
}
// tileable value noise: px x py cells over a w x h image, returns 0..1 per pixel
function tileNoise(w, h, px, py, seed) {
  const r = makeRng(seed), g = new Float32Array(px * py), out = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const sx = px / w, sy = py / h;
  for (let y = 0; y < h; y++) {
    const fy = y * sy, iy = Math.floor(fy), ty = fy - iy, vy = ty * ty * (3 - 2 * ty), y0 = (iy % py) * px, y1 = ((iy + 1) % py) * px;
    for (let x = 0; x < w; x++) {
      const fx = x * sx, ix = Math.floor(fx), tx = fx - ix, vx = tx * tx * (3 - 2 * tx), x0 = ix % px, x1 = (ix + 1) % px;
      const a = g[y0 + x0] + (g[y0 + x1] - g[y0 + x0]) * vx, b = g[y1 + x0] + (g[y1 + x1] - g[y1 + x0]) * vx;
      out[y * w + x] = a + (b - a) * vy;
    }
  }
  return out;
}
function imageTex(w, h, fill, srgb) {
  return canvasTex(w, h, (g) => { const im = g.createImageData(w, h); fill(im.data); g.putImageData(im, 0, 0); }, srgb);
}

// terrain detail (multiplies the vertex colours, one tile = 7 m): clumpy grass/soil breakup plus fine grit
const grainTex = (function () {
  const S = 512, n1 = tileNoise(S, S, 6, 6, 7), n2 = tileNoise(S, S, 24, 24, 8), n3 = tileNoise(S, S, 96, 96, 9), r = makeRng(10);
  return imageTex(S, S, d => {
    for (let i = 0; i < S * S; i++) {
      let v = 0.8 + (n1[i] - 0.5) * 0.16 + (n2[i] - 0.5) * 0.16 + (n3[i] - 0.5) * 0.14 + (r() - 0.5) * 0.08;
      const k = r(); if (k < 0.035) v -= 0.14; else if (k > 0.985) v += 0.1;
      v = Math.max(0.45, Math.min(1, v)) * 255;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
  }, false);
})();

// road: 13 m across, 16 m per repeat. Asphalt aggregate, polished tyre lanes, a repair patch, sealed cracks, worn paint, kerbs.
const roadTex = (function () {
  const w = 512, h = 2048;
  const n1 = tileNoise(w, h, 8, 32, 3), n2 = tileNoise(w, h, 40, 160, 4), n3 = tileNoise(w, h, 128, 512, 5), r = makeRng(6);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const im = g.createImageData(w, h), d = im.data;
  const band = (u, a, b, e) => ss(a - e, a + e, u) * (1 - ss(b - e, b + e, u));
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, u = (x + 0.5) / w;
      let L = 54 + (n1[i] - 0.5) * 16 + (n2[i] - 0.5) * 12 + (n3[i] - 0.5) * 10;
      const lane = Math.exp(-((u - 0.27) ** 2) / 0.0022) + Math.exp(-((u - 0.73) ** 2) / 0.0022);
      L -= lane * 9;
      const patch = band(u, 0.56, 0.84, 0.01) * band(v, 0.22, 0.43, 0.004) * ss(0.25, 0.4, n2[i] * 0.3 + 0.35);
      L -= patch * 8;
      const k = r(), stones = 1 - lane * 0.6 - patch * 0.7;
      if (k > 1 - 0.07 * stones) L += 14 + r() * 26; else if (k < 0.05) L -= 16;
      let R = L, G = L, B = L + 4;
      // kerbs: 2 m red/white blocks with a shaded inner lip
      const kerb = u < 0.035 ? u / 0.035 : u > 0.965 ? (1 - u) / 0.035 : -1;
      if (kerb >= 0) {
        const white = Math.floor(v * 8) % 2 === 1, sh = 0.78 + 0.22 * ss(0.0, 0.5, kerb) * (1 - ss(0.85, 1, kerb) * 0.4), gr = 0.9 + n3[i] * 0.12;
        [R, G, B] = white ? [226, 222, 214] : [192, 54, 40]; R *= sh * gr; G *= sh * gr; B *= sh * gr;
      }
      // paint: white edge lines + yellow centre dash, worn by noise with aggregate showing through
      const edge = band(u, 0.05, 0.068, 0.0015) + band(u, 0.932, 0.95, 0.0015), dash = band(u, 0.49, 0.51, 0.0015) * band(v, 0.0, 0.45, 0.001);
      const cover = Math.min(1, edge + dash) * (0.95 - (n3[i] > 0.72 ? 0.5 : 0) - (k < 0.08 ? 0.45 : 0)) * (0.8 + 0.2 * n1[i]);
      if (cover > 0) { const P = dash > 0 ? [226, 176, 58] : [230, 227, 219]; R += (P[0] - R) * cover; G += (P[1] - G) * cover; B += (P[2] - B) * cover; }
      d[i * 4] = R; d[i * 4 + 1] = G; d[i * 4 + 2] = B; d[i * 4 + 3] = 255;
    }
  }
  g.putImageData(im, 0, 0);
  // sealed cracks: dark tar lines wandering across the lanes, kept away from the tile seams
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let k = 0; k < 4; k++) {
    let x = w * (0.12 + r() * 0.76), y = h * (0.08 + r() * 0.8), a = r() * TAU;
    g.strokeStyle = `rgba(24,25,27,${0.3 + r() * 0.25})`; g.lineWidth = 1.2 + r() * 1.6; g.beginPath(); g.moveTo(x, y);
    for (let s = 0, n = 10 + r() * 30; s < n; s++) {
      a += (r() - 0.5) * 1.1; x = clamp(x + Math.cos(a) * 9, w * 0.08, w * 0.92); y = clamp(y + Math.sin(a) * 14, h * 0.04, h * 0.96); g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.encoding = THREE.sRGBEncoding; return t;
})();

// water normals: a sum of wind-aligned sine waves with integer frequencies so the tile repeats seamlessly
const waterNormal = (function () {
  const S = 256, d = new Uint8Array(S * S * 4), r = makeRng(21), waves = [];
  for (let i = 0; i < 22; i++) {
    const f = 2 + Math.floor(r() * r() * 22), a = 0.35 + (r() - 0.5) * 1.6;
    const kx = Math.round(Math.cos(a) * f), ky = Math.round(Math.sin(a) * f) || 1;
    waves.push([kx, ky, 1 / Math.pow(Math.hypot(kx, ky), 1.25), r() * TAU]);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let dx = 0, dy = 0;
    for (const [kx, ky, am, ph] of waves) { const c = Math.cos((kx * x + ky * y) / S * TAU + ph) * am; dx += c * kx; dy += c * ky; }
    const nx = -dx * 0.9, ny = -dy * 0.9, l = Math.hypot(nx, ny, 3.2), i = (y * S + x) * 4;
    d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (3.2 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.needsUpdate = true; return t;
})();
waterNormal.repeat.set(160, 160);
// Two normal layers scrolling in different directions hide the tiling; ripples and gloss calm down with distance to avoid shimmer.
const waterTime = { value: 0 };
const waterMat = new THREE.MeshStandardMaterial({ color: C(0x1d5566), roughness: 0.05, metalness: 0.08, transparent: true, opacity: 0.88, normalMap: waterNormal, normalScale: new THREE.Vector2(0.32, 0.32), envMapIntensity: 1.1 });
waterMat.onBeforeCompile = sh => {
  sh.uniforms.uTime = waterTime;
  sh.fragmentShader = 'uniform float uTime;\n' + sh.fragmentShader
    .replace('vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;', `vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;
      vec3 mapN2 = texture2D( normalMap, mat2(0.8, -0.6, 0.6, 0.8) * vUv * 0.37 + vec2(uTime * 0.013, -uTime * 0.021) ).xyz * 2.0 - 1.0;
      mapN = vec3(mapN.xy + mapN2.xy * 0.6, mapN.z * mapN2.z);
      mapN.xy *= mix(1.0, 0.3, smoothstep(30.0, 450.0, length(vViewPosition)));`)
    .replace('float roughnessFactor = roughness;', 'float roughnessFactor = mix(roughness, 0.22, smoothstep(80.0, 900.0, length(vViewPosition)));');
};
const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), waterMat);
water.position.y = WATER; water.receiveShadow = true;
scene.add(water);


/* ================= per-frame render hook =================
   Runs inside renderer.render() before the shadow pass, after main.js has placed the sun on the car.
   1. Shifts the shadow box ahead of the camera and snaps it to whole shadow-map texels so edges don't crawl.
   2. Culls world tiles: a tile's instanced props are drawn only if the tile is in view or near the shadow box,
      small props (rocks) only up close, and only tiles near the shadow box cast shadows.
   3. Dynamic resolution: drops the pixel ratio while frames run slow and raises it again once they recover. */
const renderStats = { pr: PR_MAX, ft: 16, tilesDrawn: 0, casters: 0 };
{
  const up = new V3(0, 1, 0), ax = new V3().crossVectors(up, sunDir).normalize(), ay = new V3().crossVectors(sunDir, ax).normalize();
  const cf = new V3(), ctr = new V3(), sc = sun.shadow.camera, texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), tb = new THREE.Box3();
  const SHADOW_REACH = 70 * Math.SQRT2 + 30;   // shadow box half-diagonal plus the length of a tall tree's shadow
  // Visible range per prop from its size. Parts of one prop (trunk + crown) share the same instance matrices,
  // so they are grouped by their first instance and take the range of the largest part, keeping them together.
  function tileReach(t) {
    const groups = new Map();
    for (const o of t.group.children) {
      if (!o.isInstancedMesh) continue;
      const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
      const m = o.instanceMatrix.array, k = `${o.count}:${m[12].toFixed(2)}:${m[14].toFixed(2)}`;
      groups.set(k, Math.max(groups.get(k) || 0, g.boundingSphere.radius));
      o.userData.reachKey = k;
    }
    for (const o of t.group.children) if (o.isInstancedMesh) o.userData.reach = Math.min(640, 60 + groups.get(o.userData.reachKey) * 150);
    t.reachDone = true;
  }
  function cullTiles(cam) {
    if (typeof tiles === 'undefined' || typeof TILE === 'undefined') return;
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(pv);
    const px = cam.position.x, pz = cam.position.z; let drawn = 0, casters = 0;
    for (const t of tiles.values()) {
      const x0 = t.tx * TILE, z0 = t.tz * TILE;
      tb.min.set(x0 - 15, -40, z0 - 15); tb.max.set(x0 + TILE + 15, 450, z0 + TILE + 15);
      const dCam = Math.hypot(px - clamp(px, x0, x0 + TILE), pz - clamp(pz, z0, z0 + TILE));
      const dSh = Math.hypot(ctr.x - clamp(ctr.x, x0, x0 + TILE), ctr.z - clamp(ctr.z, z0, z0 + TILE));
      const inView = frustum.intersectsBox(tb), shadow = dSh < SHADOW_REACH;
      if (!t.reachDone) tileReach(t);
      const ch = t.group.children;
      for (let i = 0; i < ch.length; i++) {
        const o = ch[i]; if (!o.isInstancedMesh) continue;
        const near = dCam < o.userData.reach;
        o.visible = near && (inView || shadow);
        o.castShadow = shadow && near;
        if (o.visible) drawn++; if (o.castShadow) casters++;
      }
    }
    renderStats.tilesDrawn = drawn; renderStats.casters = casters;
  }
  let lastT = 0, slowN = 0, goodN = 0, cooldown = 300;   // frames of good timing needed before stepping back up; grows after each drop to avoid see-sawing
  function adaptResolution() {
    const now = performance.now(), d = lastT ? Math.min(now - lastT, 40) : 16; lastT = now;
    const ft = renderStats.ft += (d - renderStats.ft) * 0.05;
    slowN = ft > 21 ? slowN + 1 : 0;                // below ~48 fps
    goodN = ft < 17.6 ? goodN + 1 : 0;              // holding 60 fps (or better)
    let pr = renderStats.pr;
    if (slowN > 45 && pr > PR_MIN) { pr = Math.max(PR_MIN, pr - 0.1); cooldown = Math.min(cooldown * 1.4, 2400); }
    else if (goodN > cooldown && pr < PR_MAX) pr = Math.min(PR_MAX, pr + 0.1);
    else return;
    slowN = goodN = 0; renderStats.ft = 16; renderStats.pr = pr;
    renderer.setPixelRatio(pr);
    if (typeof smokeMat !== 'undefined') smokeMat.uniforms.uScale.value = innerHeight * pr / 2;
  }
  scene.onBeforeRender = (r, s, cam) => {
    waterTime.value = performance.now() / 1000;
    cam.getWorldDirection(cf); cf.y = 0; if (cf.lengthSq() > 1e-6) cf.normalize();
    ctr.copy(sun.target.position).addScaledVector(cf, 26);
    const a = ctr.dot(ax), b = ctr.dot(ay);
    ctr.addScaledVector(ax, Math.round(a / texel) * texel - a).addScaledVector(ay, Math.round(b / texel) * texel - b);
    sun.target.position.copy(ctr); sun.position.copy(ctr).addScaledVector(sunDir, 300);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    cullTiles(cam);
    if (cam === camera) adaptResolution();
  };
}
