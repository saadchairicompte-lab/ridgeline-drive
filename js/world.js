// Ridgeline Drive: Road ribbon, roadside posts, start gantry and the streamed terrain tiles with instanced trees, rocks and colliders.
// Classic script: top-level declarations are shared with the other files, loaded in the order index.html lists them.
'use strict';
/* ================= road + roadside ================= */
{
  const { N, xs, zs, hs, dist } = road;
  const pos = new Float32Array((N + 1) * 6), uv = new Float32Array((N + 1) * 4), idx = [];
  for (let i = 0; i <= N; i++) {
    const k = i % N, p = (k - 1 + N) % N, n = (k + 1) % N;
    let tx = xs[n] - xs[p], tz = zs[n] - zs[p]; const l = Math.hypot(tx, tz); tx /= l; tz /= l;
    const nx = -tz, nz = tx, y = hs[k] + 0.05;
    pos.set([xs[k] + nx * ROAD_HALF, y, zs[k] + nz * ROAD_HALF, xs[k] - nx * ROAD_HALF, y, zs[k] - nz * ROAD_HALF], i * 6);
    uv.set([0, dist[i] / 16, 1, dist[i] / 16], i * 4);
    if (i < N) { const a = 2 * i, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, envMapIntensity: 0.5 }));
  m.receiveShadow = true; scene.add(m);

  // reflector posts
  const every = 6, count = Math.floor(N / every) * 2;
  const postG = new THREE.BoxGeometry(0.14, 1.0, 0.14).translate(0, 0.5, 0), capG = new THREE.BoxGeometry(0.15, 0.16, 0.15).translate(0, 0.9, 0);
  const posts = new THREE.InstancedMesh(postG, new THREE.MeshStandardMaterial({ color: C(0xe9e6df), roughness: 0.6 }), count);
  const caps = new THREE.InstancedMesh(capG, new THREE.MeshStandardMaterial({ color: C(0xf29a2e), emissive: C(0xf29a2e), emissiveIntensity: 0.6 }), count);
  const mtx = new THREE.Matrix4(); let c = 0;
  for (let i = 0; i < N - every + 1; i += every) {
    const n = (i + 1) % N; let tx = xs[n] - xs[i], tz = zs[n] - zs[i]; const l = Math.hypot(tx, tz); tx /= l; tz /= l;
    for (const s of [1, -1]) {
      const x = xs[i] - tz * s * (ROAD_HALF + 1.1), z = zs[i] + tx * s * (ROAD_HALF + 1.1);
      mtx.makeTranslation(x, H(x, z) - 0.05, z); posts.setMatrixAt(c, mtx); caps.setMatrixAt(c, mtx); c++;
    }
  }
  posts.count = caps.count = c; posts.castShadow = true; posts.frustumCulled = caps.frustumCulled = false;
  scene.add(posts, caps);

  // start / finish gantry
  const k = 0, n = 1, gtx = xs[n] - xs[k], gtz = zs[n] - zs[k];
  const gantry = new THREE.Group(); gantry.position.set(xs[k], hs[k], zs[k]); gantry.rotation.y = Math.atan2(gtx, gtz);
  const steel = new THREE.MeshStandardMaterial({ color: C(0x2c3034), metalness: 0.6, roughness: 0.4 });
  const checker = canvasTex(256, 32, (g2, w, h) => { for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) { g2.fillStyle = (x + y) % 2 ? '#111' : '#eee'; g2.fillRect(x * 8, y * 8, 8, 8); } });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), steel); p.position.set(s * (ROAD_HALF + 1.6), 3.5, 0); p.castShadow = true; gantry.add(p); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * ROAD_HALF + 3.7, 1.1, 0.5), [steel, steel, steel, steel, new THREE.MeshStandardMaterial({ map: checker }), new THREE.MeshStandardMaterial({ map: checker })]);
  beam.position.y = 6.6; beam.castShadow = true; gantry.add(beam);
  scene.add(gantry);
}


/* ================= terrain tiles ================= */
const TILE = 200, SEG = 80, SEG_FAR = 40, RANGE = 3; // SEG for the 3x3 around the car, SEG_FAR beyond it
const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: grainTex, roughness: 0.95, metalness: 0, envMapIntensity: 0.45 });
const COL = { gA: C(0x4d7a2a), gB: C(0x78973a), dry: C(0xa39a5a), rock: C(0x7b766e), rockD: C(0x5b5750), sand: C(0xd3c294), snow: C(0xeef2f5), dirt: C(0x7c6547), mud: C(0x4b4735) };

function mergeGeos(list) {
  const parts = list.map(g => g.index ? g.toNonIndexed() : g); let n = 0; parts.forEach(g => n += g.attributes.position.count);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  parts.forEach(g => { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; });
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); return out;
}
const GEO = {
  trunk: new THREE.CylinderGeometry(0.16, 0.3, 3, 6).translate(0, 1.5, 0),
  pine: mergeGeos([new THREE.ConeGeometry(2.3, 4.4, 8).translate(0, 3.8, 0), new THREE.ConeGeometry(1.75, 3.6, 8).translate(0, 5.9, 0), new THREE.ConeGeometry(1.1, 2.8, 8).translate(0, 7.7, 0)]),
  broad: mergeGeos([new THREE.IcosahedronGeometry(2.6, 0).translate(0, 4.6, 0), new THREE.IcosahedronGeometry(1.9, 0).translate(1.4, 5.4, 0.6), new THREE.IcosahedronGeometry(1.8, 0).translate(-1.2, 5.2, -0.8)]),
  rock: (function () { const g = new THREE.DodecahedronGeometry(1, 0).toNonIndexed(), p = g.attributes.position, r = makeRng(11), seen = new Map();
    for (let i = 0; i < p.count; i++) { const k = p.getX(i).toFixed(3) + p.getY(i).toFixed(3) + p.getZ(i).toFixed(3); let s = seen.get(k); if (!s) seen.set(k, s = 0.75 + r() * 0.5); p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.7, p.getZ(i) * s); }
    g.computeVertexNormals(); return g; })()
};
const MAT = {
  trunk: new THREE.MeshStandardMaterial({ color: C(0x5a4232), roughness: 0.9 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true, envMapIntensity: 0.4 }),
  rock: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true, envMapIntensity: 0.4 })
};
const tiles = new Map(); let tileQueue = [];
const tkey = (tx, tz) => (tx + 5000) * 10000 + (tz + 5000);

// Tile construction is a generator so the streaming code can spread it over several frames (it yields
// between batches of height samples); buildTile() runs one to completion.
function buildTile(tx, tz, seg = SEG) { const job = tileJob(tx, tz, seg); while (!job.next().done); }
function* tileJob(tx, tz, SEG) {
  const STEP = TILE / SEG, ox = tx * TILE, oz = tz * TILE, S = SEG + 3, hg = new Float32Array(S * S), rd = new Float32Array(S * S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) { hg[j * S + i] = H(ox + (i - 1) * STEP, oz + (j - 1) * STEP); rd[j * S + i] = lastRoadD; }
    if (j % 6 === 5) yield;
  }
  const E = (SEG + 1) * 4, V = (SEG + 1) * (SEG + 1) + E, pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), col = new Float32Array(V * 3), uv = new Float32Array(V * 2);
  const c = new THREE.Color();
  let v = 0;
  for (let j = 0; j <= SEG; j++) for (let i = 0; i <= SEG; i++, v++) {
    if (i === 0 && j % 20 === 19) yield;
    const gi = (j + 1) * S + (i + 1), h = hg[gi], x = ox + i * STEP, z = oz + j * STEP;
    let nx = hg[gi - 1] - hg[gi + 1], ny = 2 * STEP, nz = hg[gi - S] - hg[gi + S]; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    pos[v * 3] = i * STEP; pos[v * 3 + 1] = h; pos[v * 3 + 2] = j * STEP;
    nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
    uv[v * 2] = x / 7; uv[v * 2 + 1] = z / 7;
    const n1 = noise2(x / 70, z / 70) + 0.5, n2 = noise2(x / 260 + 9, z / 260) + 0.5, n3 = noise2(x / 9, z / 9);
    c.copy(COL.gA).lerp(COL.gB, ss(0.25, 0.75, n1)).lerp(COL.dry, ss(0.55, 0.9, n2) * 0.75);
    const r = rd[gi]; if (r < ROAD_HALF + 5) c.lerp(COL.dirt, ss(ROAD_HALF + 5, ROAD_HALF + 1.2, r) * 0.85);
    c.lerp(COL.sand, ss(3.4, 1.2, h)).lerp(COL.mud, ss(0.3, -2.5, h));
    c.lerp(n3 > 0 ? COL.rock : COL.rockD, ss(0.88, 0.74, ny));
    c.lerp(COL.snow, ss(125, 160, h + n3 * 10) * ss(0.7, 0.84, ny));
    const b = 0.92 + 0.08 * n3; col[v * 3] = c.r * b; col[v * 3 + 1] = c.g * b; col[v * 3 + 2] = c.b * b;
  }
  // skirts: each edge row is copied 3 m lower and stitched to the edge (both windings), hiding the cracks
  // where a detailed tile meets a coarser neighbour
  const edges = [k => k, k => SEG * (SEG + 1) + k, k => k * (SEG + 1), k => k * (SEG + 1) + SEG];
  const idx = new Uint16Array(SEG * SEG * 6 + 4 * SEG * 12); let q = 0;
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * (SEG + 1) + i, b = a + 1, cc = a + SEG + 1, d = cc + 1;
    idx[q++] = a; idx[q++] = cc; idx[q++] = b; idx[q++] = b; idx[q++] = cc; idx[q++] = d;
  }
  edges.forEach((ev, e) => {
    const base = (SEG + 1) * (SEG + 1) + e * (SEG + 1);
    for (let k = 0; k <= SEG; k++) {
      const src = ev(k), dst = base + k;
      pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - 3; pos[dst * 3 + 2] = pos[src * 3 + 2];
      for (let t = 0; t < 3; t++) { nor[dst * 3 + t] = nor[src * 3 + t]; col[dst * 3 + t] = col[src * 3 + t]; }
      uv[dst * 2] = uv[src * 2]; uv[dst * 2 + 1] = uv[src * 2 + 1];
      if (k < SEG) { const a = src, b = ev(k + 1), c2 = dst, d = dst + 1; idx.set([a, c2, b, b, c2, d, a, b, c2, b, d, c2], q); q += 12; }
    }
  });
  yield;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, terrainMat); mesh.position.set(ox, 0, oz); mesh.receiveShadow = true;
  const group = new THREE.Group(); group.add(mesh);

  // vegetation + rocks, deterministic per tile
  const r = makeRng((tx * 73856093) ^ (tz * 19349663) ^ 0x5bd1e995);
  const pines = [], broads = [], rocks = [], colliders = [];
  for (let k = 0; k < 480; k++) {
    if (k % 120 === 119) yield;
    const x = ox + r() * TILE, z = oz + r() * TILE, rv = r(), sc = 0.75 + r() * 0.75, rot = r() * TAU, hue = r();
    const dens = ss(-0.12, 0.22, fbm(x / 380 + 50, z / 380, 3));
    if (rv > dens * 0.9 + 0.04) continue;
    const h = H(x, z); if (lastRoadD < ROAD_HALF + 7 || h < 2.2 || h > 140) continue;
    if (Math.abs(H(x + 2, z) - h) + Math.abs(H(x, z + 2) - h) > 2.4) continue;
    (h > 45 || hue < 0.6 ? pines : broads).push([x, h - 0.2, z, sc, rot, hue]);
    colliders.push(x, z, 0.35 * sc + 0.1, h);
  }
  for (let k = 0; k < 40; k++) {
    const x = ox + r() * TILE, z = oz + r() * TILE, sc = 0.4 + r() * r() * 2.6, rot = r() * TAU, hue = r();
    const h = H(x, z); if (lastRoadD < ROAD_HALF + 4) continue;
    rocks.push([x, h - 0.25 * sc, z, sc, rot, hue]);
    if (sc > 0.9) colliders.push(x, z, sc * 0.9, h);
  }
  yield;
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sv = new V3(), pv = new V3(), yAx = new V3(0, 1, 0), tc = new THREE.Color();
  function inst(geo, mat, list, colorFn, scaleFn) {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => { pv.set(t[0], t[1], t[2]); qq.setFromAxisAngle(yAx, t[4]); scaleFn(sv, t[3]); m4.compose(pv, qq, sv); im.setMatrixAt(i, m4); if (colorFn) { colorFn(tc, t[5]); im.setColorAt(i, tc); } });
    im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; group.add(im);
  }
  const uni = (s, k) => s.set(k, k, k);
  const tint = (c2, h) => c2.setScalar(0.8 + h * 0.35);
  const instProp = (name, list, scaleFn) => PROPS[name].parts.forEach(p => inst(p.geo, p.mat, list, tint, scaleFn));
  if (PROPS.tree_pine && PROPS.tree_broadleaf && PROPS.rock_large && PROPS.rock_small) {
    instProp('tree_pine', pines, (s, k) => s.set(k * 1.25, k * 1.4, k * 1.25));
    instProp('tree_broadleaf', broads, (s, k) => s.setScalar(k * 1.2));
    instProp('rock_large', rocks.filter(t => t[3] > 1.1), (s, k) => s.setScalar(k * 0.75));
    instProp('rock_small', rocks.filter(t => t[3] <= 1.1), (s, k) => s.setScalar(k * 1.9));
  } else {
    inst(GEO.trunk, MAT.trunk, pines.concat(broads), null, uni);
    inst(GEO.pine, MAT.leaf, pines, (c2, h) => c2.setHSL(0.30 + h * 0.06, 0.42, 0.17 + h * 0.07).convertSRGBToLinear(), (s, k) => s.set(k, k * (0.9 + (k % 0.2)), k));
    inst(GEO.broad, MAT.leaf, broads, (c2, h) => c2.setHSL(0.2 + h * 0.08, 0.45, 0.26 + h * 0.08).convertSRGBToLinear(), uni);
    inst(GEO.rock, MAT.rock, rocks, (c2, h) => c2.setHSL(0.08, 0.06, 0.34 + h * 0.14).convertSRGBToLinear(), (s, k) => s.set(k * 1.2, k, k));
  }
  const rs = roadsideInst.get(tkey(tx, tz));
  if (rs) for (const [name, mats] of rs) PROPS[name].parts.forEach(p => {
    const im = new THREE.InstancedMesh(p.geo, p.mat, mats.length);
    mats.forEach((m, i) => im.setMatrixAt(i, m)); im.receiveShadow = true; im.frustumCulled = false; group.add(im);
  });
  const extra = roadsideCol.get(tkey(tx, tz)); if (extra) colliders.push(...extra);
  const old = tiles.get(tkey(tx, tz)); if (old) disposeTile(tkey(tx, tz), old);
  scene.add(group);
  tiles.set(tkey(tx, tz), { tx, tz, seg: SEG, group, col: new Float32Array(colliders) });
}
function disposeTile(k, t) { if (tiles.get(k) !== t) return; scene.remove(t.group); t.group.children[0].geometry.dispose(); t.group.children.forEach(o => o.dispose && o.dispose()); tiles.delete(k); }
let curTx = 1e9, curTz = 1e9, tileJobNow = null;
const segFor = (tx, tz) => Math.max(Math.abs(tx - curTx), Math.abs(tz - curTz)) <= 1 ? SEG : SEG_FAR;
// budget: tiles to finish synchronously (boot), or 0 in the frame loop, where queued tiles are built in
// slices of about 3 ms per frame. Tiles entering the 3x3 around the car are rebuilt at full detail, and
// tiles leaving it drop back to the coarse grid.
function updateTiles(x, z, budget) {
  const ctx = Math.floor(x / TILE), ctz = Math.floor(z / TILE);
  if (ctx !== curTx || ctz !== curTz) {
    curTx = ctx; curTz = ctz; tileJobNow = null;
    for (const [k, t] of tiles) if (Math.max(Math.abs(t.tx - ctx), Math.abs(t.tz - ctz)) > RANGE + 1) disposeTile(k, t);
    tileQueue = [];
    for (let dz = -RANGE; dz <= RANGE; dz++) for (let dx = -RANGE; dx <= RANGE; dx++) {
      const t = tiles.get(tkey(ctx + dx, ctz + dz)), seg = segFor(ctx + dx, ctz + dz);
      if (!t || t.seg !== seg) tileQueue.push([ctx + dx, ctz + dz, dx * dx + dz * dz + (!t ? 0 : t.seg < seg ? 4 : 30)]);
    }
    tileQueue.sort((a, b) => a[2] - b[2]);
  }
  const t0 = performance.now();
  while (budget > 0 || performance.now() - t0 < 3) {
    if (!tileJobNow) {
      const next = tileQueue.shift(); if (!next) break;
      const [a, b] = next, seg = segFor(a, b), t = tiles.get(tkey(a, b));
      if (Math.max(Math.abs(a - curTx), Math.abs(b - curTz)) > RANGE || (t && t.seg === seg)) continue;
      tileJobNow = tileJob(a, b, seg);
    }
    if (tileJobNow.next().done) { tileJobNow = null; budget--; }
  }
}

/* ================= Blender props ================= */
// assets/props/*.glb from the Blender thread. Each prop is normalised on load (centred in x/z, base at y = 0)
// and baked into plain geometries so tiles can instance it. If loading fails the procedural shapes above are used.
const PROP_NAMES = ['tree_pine', 'tree_broadleaf', 'rock_large', 'rock_small', 'barrier_concrete', 'guardrail', 'building_garage'];
const PROPS = {};
const propsReady = new Promise(resolve => {
  let left = PROP_NAMES.length;
  const done = () => { if (--left === 0) resolve(); };
  PROP_NAMES.forEach(n => loadGLB(n, 'assets/props/' + n + '.glb', g => {
    g.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g.scene), c = box.getCenter(new V3());
    const shift = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z), parts = [];
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(shift, o.matrixWorld));
      if (o.material) o.material.envMapIntensity = 0.5;
      parts.push({ geo, mat: o.material });
    });
    PROPS[n] = { parts, size: box.getSize(new V3()) };
    done();
  }, done));
  setTimeout(resolve, 12000);
});

/* ================= roadside furniture ================= */
// Guardrails where the road runs on an embankment or causeway, concrete barriers on the outside of the
// sharpest corners, and a garage on a levelled pad near the start. Their colliders are merged into the
// tiles they fall in, so the car hits them through the same tree-collision pass.
const roadsideCol = new Map(), roadsideInst = new Map(); // per tile key: collider floats / Map(prop name -> matrices)
function addCol(x, z, r, h) { const k = tkey(Math.floor(x / TILE), Math.floor(z / TILE)); let l = roadsideCol.get(k); if (!l) roadsideCol.set(k, l = []); l.push(x, z, r, h); }
function placeRoadside() {
  const { N, xs, zs, hs } = road, m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), yAx = new V3(0, 1, 0), one = new V3(1, 1, 1), pv = new V3();
  const tan = i => { const a = (i - 1 + N) % N, b = (i + 1) % N; let tx = xs[b] - xs[a], tz = zs[b] - zs[a]; const l = Math.hypot(tx, tz); return [tx / l, tz / l]; };
  // bucket each instance into the tile it stands in; buildTile turns the buckets into instanced meshes
  const addAll = (name, mats) => {
    if (!PROPS[name]) return;
    for (const m of mats) {
      const k = tkey(Math.floor(m.elements[12] / TILE), Math.floor(m.elements[14] / TILE));
      let b = roadsideInst.get(k); if (!b) roadsideInst.set(k, b = new Map());
      let l = b.get(name); if (!l) b.set(name, l = []); l.push(m);
    }
  };
  // object whose local X runs along the road, placed `off` metres to one side (s = +1 left, -1 right)
  const along = (x, z, tx, tz, yaw) => { const h = H(x, z); pv.set(x, h - 0.03, z); q4.setFromAxisAngle(yAx, yaw); return [m4.clone().compose(pv, q4, one), h]; };

  const rails = [];
  for (let i = 0; i < N; i++) {
    const [tx, tz] = tan(i), j = (i + 1) % N, mx = (xs[i] + xs[j]) / 2, mz = (zs[i] + zs[j]) / 2;
    for (const s of [1, -1]) {
      const off = ROAD_HALF + 1.8, x = mx - tz * s * off, z = mz + tx * s * off, raw = terrainRaw(x, z);
      if (hs[i] - raw < 2.5 && raw > WATER + 1) continue;
      const [mtx, h] = along(x, z, tx, tz, Math.atan2(-tz, tx) + (s > 0 ? Math.PI : 0)); rails.push(mtx);
      for (const d of [-1.5, -0.5, 0.5, 1.5]) addCol(x + tx * d, z + tz * d, 0.3, h);
    }
  }
  addAll('guardrail', rails);

  // corner sharpness: heading change across +-8 samples
  const turn = new Float32Array(N);
  for (let i = 0; i < N; i++) { const [ax, az] = tan((i - 8 + N) % N), [bx, bz] = tan((i + 8) % N); turn[i] = Math.atan2(ax * bz - az * bx, ax * bx + az * bz); }
  const corners = [];
  for (const i of [...Array(N).keys()].sort((a, b) => Math.abs(turn[b]) - Math.abs(turn[a]))) {
    if (Math.abs(turn[i]) < 0.35 || corners.length >= 8) break;
    if (corners.every(c => Math.min(Math.abs(c - i), N - Math.abs(c - i)) > 60)) corners.push(i);
  }
  const barriers = [];
  for (const c of corners) {
    const out = turn[c] > 0 ? -1 : 1; // turning toward the +n side puts the outside of the corner on -n
    for (let k = -10; k <= 10; k++) {
      const i = (c + k + N) % N, [tx, tz] = tan(i), off = ROAD_HALF + 3.5, x = xs[i] - tz * out * off, z = zs[i] + tx * out * off;
      if (H(x, z) < WATER + 0.5) continue;
      const [mtx, h] = along(x, z, tx, tz, Math.atan2(-tz, tx) + (out > 0 ? Math.PI : 0)); barriers.push(mtx);
      for (const d of [-1, 0, 1]) addCol(x + tx * d, z + tz * d, 0.35, h);
    }
  }
  addAll('barrier_concrete', barriers);

  // garage: flattest spot 60-280 m past the gantry, set back from the road, door facing the road
  if (PROPS.building_garage) {
    let best = null;
    for (let i = 15; i < 70; i += 3) for (const s of [1, -1]) {
      const [tx, tz] = tan(i), off = ROAD_HALF + 24, x = xs[i] - tz * s * off, z = zs[i] + tx * s * off;
      const hh = [[-7, -7], [7, -7], [-7, 7], [7, 7], [0, 0]].map(([a, b]) => H(x + a, z + b));
      const score = Math.max(...hh) - Math.min(...hh);
      if (hh[4] > WATER + 1.5 && (!best || score < best.score)) best = { x, z, h: hh[4], score, yaw: Math.atan2(-tz * s, tx * s) };
    }
    if (best) {
      PADS.push({ x: best.x, z: best.z, h: best.h, r: 9, f: 14 });
      pv.set(best.x, best.h - 0.05, best.z); q4.setFromAxisAngle(yAx, best.yaw);
      addAll('building_garage', [m4.clone().compose(pv, q4, one)]);
      const sz = PROPS.building_garage.size, hx = sz.x / 2, hz = sz.z / 2, cs = Math.cos(best.yaw), sn = Math.sin(best.yaw);
      for (let a = -hx; a <= hx + 0.01; a += 1.2) for (const b of [-hz, hz]) addCol(best.x + a * cs + b * sn, best.z - a * sn + b * cs, 0.7, best.h);
      for (let b = -hz; b <= hz + 0.01; b += 1.2) for (const a of [-hx, hx]) addCol(best.x + a * cs + b * sn, best.z - a * sn + b * cs, 0.7, best.h);
      garageSpot = best;
    }
  }
}
let garageSpot = null;
