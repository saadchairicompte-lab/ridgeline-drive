// Ridgeline Drive: Car visuals: procedural placeholder body and wheels, plus loadCarModel() which swaps in assets/car.glb from Blender when present.
// Classic script: top-level declarations are shared with the other files, loaded in the order index.html lists them.
'use strict';
/* ================= car model ================= */
const PAINTS = [0xc8321f, 0x1d5fa8, 0xe9e6df, 0x2e3034, 0xe3a92a, 0x2f6b47];
let paintIdx = 0;
let R_WHEEL = 0.33; // replaced by the Blender wheel size when assets/car.glb loads
const SUSP = { rest: 0.38, k: 36000, c: 3900, anchorY: 0.245 };
const WHEELS = [{ x: 0.83, z: 1.34, front: true }, { x: -0.83, z: 1.34, front: true }, { x: 0.83, z: -1.30, front: false }, { x: -0.83, z: -1.30, front: false }];
const carMats = {
  paint: new THREE.MeshPhysicalMaterial({ color: C(PAINTS[0]), metalness: 0.5, roughness: 0.33, clearcoat: 1, clearcoatRoughness: 0.05 }),
  glass: new THREE.MeshPhysicalMaterial({ color: C(0x0b1014), metalness: 0.9, roughness: 0.04, clearcoat: 1 }),
  trim: new THREE.MeshStandardMaterial({ color: C(0x141618), roughness: 0.55, metalness: 0.2 }),
  chrome: new THREE.MeshStandardMaterial({ color: C(0xd5d9dd), metalness: 1, roughness: 0.18 }),
  tire: new THREE.MeshStandardMaterial({ color: C(0x1b1b1c), roughness: 0.92 }),
  head: new THREE.MeshStandardMaterial({ color: C(0xffffff), emissive: C(0xfff3de), emissiveIntensity: 1.4 }),
  tail: new THREE.MeshStandardMaterial({ color: C(0x3a0605), emissive: C(0xff2616), emissiveIntensity: 0.7 }),
  rev: new THREE.MeshStandardMaterial({ color: C(0x444444), emissive: C(0xffffff), emissiveIntensity: 0 }),
  caliper: new THREE.MeshStandardMaterial({ color: C(0xd8a21c), roughness: 0.4 })
};
function buildCar(mats = carMats) {
  const root = new THREE.Group(), body = new THREE.Group(); body.position.y = -0.55; root.add(body);
  const ext = (shape, depth, bevel) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 18 }); g.rotateY(-Math.PI / 2); g.translate(depth / 2, 0, 0); g.computeVertexNormals(); return g; };
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; m.receiveShadow = true; body.add(m); return m; };
  const s = new THREE.Shape();
  s.moveTo(2.14, 0.30); s.lineTo(1.686, 0.30);
  s.absarc(1.34, 0.50, 0.40, -0.524, Math.PI + 0.524, false); s.lineTo(-0.954, 0.30);
  s.absarc(-1.30, 0.50, 0.40, -0.524, Math.PI + 0.524, false); s.lineTo(-2.12, 0.30);
  s.lineTo(-2.2, 0.62); s.quadraticCurveTo(-2.22, 0.96, -1.92, 0.99); s.lineTo(1.05, 1.0);
  s.quadraticCurveTo(1.95, 0.93, 2.17, 0.74); s.quadraticCurveTo(2.27, 0.52, 2.14, 0.30);
  add(ext(s, 1.72, 0.07), mats.paint, 0, 0, 0);
  const g = new THREE.Shape();
  g.moveTo(-1.62, 0.97); g.quadraticCurveTo(-1.05, 1.2, -0.72, 1.34); g.lineTo(0.2, 1.37); g.quadraticCurveTo(0.55, 1.33, 1.12, 0.99); g.lineTo(-1.62, 0.97);
  add(ext(g, 1.34, 0.07), mats.glass, 0, 0, 0);
  add(new THREE.BoxGeometry(1.3, 0.05, 0.86), mats.paint, 0, 1.425, -0.25);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.05, 0.1, 2.0), mats.trim, sx * 0.935, 0.34, 0.02);
    add(new THREE.BoxGeometry(0.4, 0.09, 0.14), mats.head, sx * 0.6, 0.76, 2.1, -0.45);
    add(new THREE.BoxGeometry(0.34, 0.08, 0.05), mats.tail, sx * 0.62, 0.84, -2.255);
    add(new THREE.BoxGeometry(0.14, 0.06, 0.05), mats.rev, sx * 0.3, 0.84, -2.255);
    add(new THREE.BoxGeometry(0.2, 0.1, 0.14), mats.paint, sx * 1.0, 1.02, 0.88);
    add(new THREE.BoxGeometry(0.05, 0.2, 0.1), mats.trim, sx * 0.55, 1.08, -1.96);
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 12), mats.chrome, sx * 0.38, 0.36, -2.2, Math.PI / 2);
  }
  add(new THREE.BoxGeometry(1.75, 0.05, 0.34), mats.paint, 0, 1.19, -1.96);
  add(new THREE.BoxGeometry(1.8, 0.05, 0.3), mats.trim, 0, 0.29, 2.08);
  add(new THREE.BoxGeometry(1.1, 0.16, 0.06), mats.trim, 0, 0.47, 2.24);
  add(new THREE.BoxGeometry(1.5, 0.12, 0.08), mats.trim, 0, 0.36, -2.2);
  // wheels
  const tireG = new THREE.CylinderGeometry(R_WHEEL, R_WHEEL, 0.26, 28).rotateZ(Math.PI / 2);
  const discG = new THREE.CylinderGeometry(0.215, 0.215, 0.24, 20).rotateZ(Math.PI / 2);
  const spokeG = new THREE.BoxGeometry(0.265, 0.39, 0.05), lipG = new THREE.TorusGeometry(0.222, 0.018, 6, 28).rotateY(Math.PI / 2);
  const wheels = WHEELS.map(W => {
    const holder = new THREE.Group(); holder.position.set(W.x, 0, W.z); root.add(holder);
    const spin = new THREE.Group(); holder.add(spin);
    const parts = [new THREE.Mesh(tireG, mats.tire), new THREE.Mesh(discG, mats.trim)];
    for (let k = 0; k < 5; k++) { const sp = new THREE.Mesh(spokeG, mats.chrome); sp.rotation.x = k / 5 * TAU; parts.push(sp); }
    for (const sx of [-1, 1]) { const lip = new THREE.Mesh(lipG, mats.chrome); lip.position.x = sx * 0.125; parts.push(lip); }
    parts.forEach(p => { p.castShadow = true; spin.add(p); });
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.12), mats.caliper); cal.position.set(-Math.sign(W.x) * 0.05, 0.12, -0.12); holder.add(cal);
    return { holder, spin };
  });
  return { root, body, wheels };
}
const carView = buildCar();
scene.add(carView.root);
// Player 2's car (split screen): same model with its own paint and lights, hidden until a second phone joins.
const carMats2 = Object.assign({}, carMats, { paint: carMats.paint.clone(), tail: carMats.tail.clone(), rev: carMats.rev.clone() });
carMats2.paint.color.copy(C(PAINTS[1]));
const carView2 = buildCar(carMats2);
carView2.root.visible = false;
scene.add(carView2.root);

/* Blender car: assets/car.glb. Conventions: 1 unit = 1 m, Y-up, car faces -Z, origin on the ground centred
   under the chassis, wheels are separate objects wheel_FL / wheel_FR / wheel_RL / wheel_RR with origins at the hubs.
   Material names containing paint/body, head or tail/brake are swapped for the game's own materials so paint
   cycling and brake lights keep working. Without the file the procedural car above stays. */
const CAR_GLB = 'assets/car.glb';
const RIDE_HEIGHT = 0.38; // ground sits this far below the physics origin (centre of mass) at rest
function loadCarModel() {
  loadGLB('car', CAR_GLB, gltf => {
    const model = gltf.scene;
    model.rotation.y = Math.PI; model.position.y = -RIDE_HEIGHT; model.updateMatrixWorld(true);
    if (['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].some(n => !model.getObjectByName(n))) { console.warn('car.glb has no wheel_FL/FR/RL/RR objects; keeping the procedural car'); return; }
    const model2 = model.clone(true);   // shares geometry; materials are swapped per car below
    fitModel(model, carView, carMats, true);
    fitModel(model2, carView2, carMats2, false);
  }, () => { /* no Blender car available: keep the procedural one */ });
}
function fitModel(model, view, mats, setLayout) {
  const hubs = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].map(n => model.getObjectByName(n));
  const p = new V3(), wq = new THREE.Quaternion(), wsc = new V3();
  hubs.forEach((h, k) => {
    h.getWorldPosition(p); h.getWorldQuaternion(wq); h.getWorldScale(wsc);
    if (setLayout) {
      if (k === 0) { R_WHEEL = p.y + RIDE_HEIGHT; SUSP.anchorY = p.y + SUSP.rest - 0.085; }
      WHEELS[k].x = p.x; WHEELS[k].z = p.z;
    }
    const wv = view.wheels[k];
    wv.holder.position.x = p.x; wv.holder.position.z = p.z;
    wv.holder.children.filter(c => c !== wv.spin).forEach(c => wv.holder.remove(c));
    wv.spin.clear();
    h.parent.remove(h); h.position.set(0, 0, 0); h.quaternion.copy(wq); h.scale.copy(wsc);
    wv.spin.add(h);
  });
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const n = (o.material && o.material.name || '').toLowerCase();
    if (/paint|body/.test(n)) o.material = mats.paint;
    else if (/tail|brake/.test(n)) o.material = mats.tail;
    else if (/head/.test(n)) o.material = mats.head;
  });
  view.body.clear();
  view.body.position.y = 0;
  view.body.add(model);
}
