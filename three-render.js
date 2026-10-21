/* ---------------- 3D city ---------------- */
const tok = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COL = {};
['--asphalt', '--asphalt-2', '--road', '--block', '--lot', '--line', '--paint', '--paint-2', '--muted', '--yellow', '--red', '--orange', '--green', '--blue', '--water', '--water-line', '--park', '--park-dot'].forEach((n) => (COL[n.slice(2)] = tok(n)));
const W3 = (x, y) => [x - 490, y - 345]; // svg px -> world x,z
let has3D = false;
let renderer, scene, camera, controls, ground, raycaster, tagLayer;
const carMeshes = new Map();
let pinGroup, incGroup, trafficGroup, hoverMesh, ringMesh;
let viewMode = 'tilt';
const MAT = {};
const GEO = {};

function groundTexture() {
  const k = 2, cv = document.createElement('canvas'); cv.width = 980 * k; cv.height = 690 * k;
  const g = cv.getContext('2d'); g.scale(k, k);
  g.fillStyle = COL.block; g.fillRect(0, 0, 980, 690);
  // park
  g.fillStyle = COL.park; g.fillRect(COLS[5] + 13, ROWS[3] + 13, COLS[7] - COLS[5] - 26, ROWS[4] - ROWS[3] - 26);
  // river
  const ry = (ROWS[2] + ROWS[3]) / 2;
  g.fillStyle = COL.water; g.beginPath(); g.moveTo(-10, ry - 30);
  for (let x = 0; x <= 1000; x += 20) g.lineTo(x, ry - 28 + Math.sin(x / 90) * 6);
  for (let x = 1000; x >= -10; x -= 20) g.lineTo(x, ry + 28 + Math.sin(x / 90 + 1) * 6);
  g.closePath(); g.fill();
  g.strokeStyle = COL['water-line']; g.lineWidth = 1.4; g.lineCap = 'round';
  for (let i = 0; i < 22; i++) { const x = 15 + i * 45 + rnd() * 20, y = ry - 14 + rnd() * 28; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 6, y - 4, x + 12, y); g.quadraticCurveTo(x + 18, y + 4, x + 24, y); g.stroke(); }
  // roads
  g.strokeStyle = COL.road; g.lineWidth = 20; g.lineCap = 'square';
  for (const e of edges) { const A = nodes[e.a], B = nodes[e.b]; g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke(); }
  // sidewalk kerbs
  g.strokeStyle = 'rgba(237,235,227,.10)'; g.lineWidth = 1;
  for (const e of edges) { const A = nodes[e.a], B = nodes[e.b], hz = A.y === B.y; for (const o of [-10.5, 10.5]) { g.beginPath(); if (hz) { g.moveTo(A.x + 10, A.y + o); g.lineTo(B.x - 10, B.y + o); } else { g.moveTo(A.x + o, A.y + 10); g.lineTo(B.x + o, B.y - 10); } g.stroke(); } }
  // lane dashes
  g.strokeStyle = 'rgba(237,235,227,.45)'; g.lineWidth = 1.2; g.setLineDash([7, 9]); g.lineCap = 'butt';
  for (const e of edges) { const A = nodes[e.a], B = nodes[e.b], hz = A.y === B.y, s = 13; g.beginPath(); g.moveTo(hz ? A.x + s : A.x, hz ? A.y : A.y + s); g.lineTo(hz ? B.x - s : B.x, hz ? B.y : B.y - s); g.stroke(); }
  g.setLineDash([]);
  // stop bars and crosswalks
  g.fillStyle = 'rgba(237,235,227,.55)';
  for (const n of [9, 14, 35, 41, 4]) { const N = nodes[n]; for (let i = -8; i <= 6; i += 4) { g.fillRect(N.x + i, N.y - 19, 2, 9); g.fillRect(N.x - 19, N.y + i, 9, 2); } }
  // depots
  for (const dp of DEPOTS) { const N = nodes[dp.node], x = N.x + dp.ox, y = N.y + dp.oy; g.fillStyle = COL.road; g.fillRect(x, y, 60, 32); g.strokeStyle = COL.green; g.setLineDash([4, 3]); g.lineWidth = 1.5; g.strokeRect(x, y, 60, 32); g.setLineDash([]); g.fillStyle = COL.green; g.font = '700 8.5px Overpass, sans-serif'; g.fillText(dp.name.toUpperCase(), x, y - 5); }
  // labels: street names and road-legend district words
  g.fillStyle = 'rgba(237,235,227,.75)'; g.font = '700 10.5px Overpass, sans-serif'; g.textAlign = 'end';
  ROWN.forEach((nm, r) => g.fillText(nm.toUpperCase(), 962, ROWS[r] - 14));
  g.textAlign = 'center'; COLN.forEach((nm, c) => g.fillText(nm.toUpperCase(), COLS[c], 683));
  g.fillStyle = 'rgba(237,235,227,.20)'; g.font = '800 15px Overpass, sans-serif';
  const legend = (t, x, y) => { g.save(); g.translate(x, y + 9); g.scale(1, 1.7); g.fillText(t.toUpperCase().split('').join(String.fromCharCode(8202)), 0, 0); g.restore(); };
  legend('Mill River', 120, ry);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 8; tex.encoding = THREE.sRGBEncoding;
  return tex;
}
function lots() {
  const out = [];
  for (let r = 0; r < ROWS.length + 1; r++) for (let c = 0; c < COLS.length + 1; c++) {
    if (r === 3) continue;
    const x0 = c === 0 ? 0 : COLS[c - 1] + 13, x1 = c === COLS.length ? 980 : COLS[c] - 13;
    const y0 = r === 0 ? 0 : ROWS[r - 1] + 13, y1 = r === ROWS.length ? 690 : ROWS[r] - 13;
    if (x1 - x0 < 20 || y1 - y0 < 20) continue;
    if (r === 4 && (c === 6 || c === 7)) continue;
    const blocked = DEPOTS.some((d) => { const N = nodes[d.node], dx = N.x + d.ox, dy = N.y + d.oy; return dx < x1 && dx + 60 > x0 && dy < y1 && dy + 32 > y0; });
    const split = rnd() < 0.5, n = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) {
      const pad = 5;
      let b;
      if (split) { const w = (x1 - x0) / n; b = { x: x0 + k * w + pad / 2, y: y0 + pad, w: w - pad, h: (y1 - y0) * (0.55 + rnd() * 0.4) - pad }; }
      else { const h = (y1 - y0) / n; b = { x: x0 + pad, y: y0 + k * h + pad / 2, w: (x1 - x0) * (0.55 + rnd() * 0.4) - pad, h: h - pad }; }
      if (blocked) { const d = DEPOTS.find((d) => { const N = nodes[d.node], dx = N.x + d.ox, dy = N.y + d.oy; return dx < b.x + b.w + 6 && dx + 66 > b.x && dy < b.y + b.h + 16 && dy + 32 > b.y; }); if (d) continue; }
      out.push(b);
    }
  }
  return out;
}
function buildingHeight(cx, cy) {
  const m = nodes[35], u = nodes[14];
  const dm = Math.hypot(cx - m.x, cy - m.y), du = Math.hypot(cx - u.x, cy - u.y);
  const core = 34 * Math.exp(-(dm * dm) / (2 * 150 * 150)) + 20 * Math.exp(-(du * du) / (2 * 130 * 130));
  return 5 + core + rnd() * (6 + core * 0.5);
}
function makeLabelTexture(text, fg, bg) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64; const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 128, 64); g.fillStyle = fg; g.font = '800 30px Overpass, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 34);
  return new THREE.CanvasTexture(cv);
}
// Tesla Cybercab modelled in Blender from reference photos (cybercab-build.py → cybercab.glb, embedded below).
// Its front light bar is the 'Lamp' material, recoloured by car state like the real car's RGB rider light.
// The box cars built in init3D stay in place if the loader or the model is unavailable.
function loadCybercab() {
  if (!THREE.GLTFLoader || !window.CYBERCAB_GLB) return;
  let bin;
  try { bin = Uint8Array.from(atob(window.CYBERCAB_GLB), (ch) => ch.charCodeAt(0)); } catch (err) { return; }
  new THREE.GLTFLoader().parse(bin.buffer, '', (gltf) => {
    const src = gltf.scene;
    src.scale.setScalar(20 / 4.445); // modelled in metres at the real 4.445 m length, scaled to the old car's 20 units
    src.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      // no environment map in this scene, so tone the brushed metal down or it renders near black
      if (o.material.metalness > 0.2) { o.material.metalness = 0.25; o.material.roughness = Math.max(o.material.roughness, 0.4); }
    });
    for (const [c, m] of carMeshes) {
      const model = src.clone();
      let body = null, lamp = null;
      model.traverse((o) => { o.userData.car = c; if (!o.isMesh) return; if (o.material.name === 'Body') body = o; if (o.material.name === 'Lamp') lamp = o; });
      if (!body || !lamp) return;
      m.g.clear(); m.g.add(model);
      m.body = body; m.bodyMat = body.material; m.lamp = lamp;
    }
  }, (err) => console.warn('Cybercab model did not load, keeping the simple cars', err));
}
function init3D() {
  const host = $('three');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(new THREE.Color(COL.asphalt));
  host.append(renderer.domElement);
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color(COL.asphalt), 1100, 2200);
  camera = new THREE.PerspectiveCamera(38, 1, 5, 4000);
  camera.position.set(-40, 560, 600);
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 20); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = 1.32; controls.minDistance = 120; controls.maxDistance = 1500; controls.screenSpacePanning = false;
  controls.update();
  raycaster = new THREE.Raycaster();
  tagLayer = $('tags3d');

  scene.add(new THREE.HemisphereLight(0xfff3dd, 0x2a2927, 0.55));
  const sun = new THREE.DirectionalLight(0xfff1d6, 0.85);
  sun.position.set(-380, 620, -260); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -620, right: 620, top: 480, bottom: -480, near: 100, far: 1600 });
  sun.shadow.bias = -0.0008;
  scene.add(sun);

  // ground
  ground = new THREE.Mesh(new THREE.PlaneGeometry(980, 690), new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200), new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.asphalt) }));
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.4; scene.add(apron);

  // buildings
  const L = lots();
  const bGeo = new THREE.BoxGeometry(1, 1, 1); bGeo.translate(0, 0.5, 0);
  const bMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.02 });
  const inst = new THREE.InstancedMesh(bGeo, bMat, L.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), base = new THREE.Color('#2f2e2b'), tmp = new THREE.Color();
  L.forEach((b, i) => {
    const h = buildingHeight(b.x + b.w / 2, b.y + b.h / 2);
    const [x, z] = W3(b.x + b.w / 2, b.y + b.h / 2);
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(b.w, h, b.h)); inst.setMatrixAt(i, m4);
    tmp.copy(base).offsetHSL(0, 0, (rnd() - 0.5) * 0.035 + h / 1600); inst.setColorAt(i, tmp);
  });
  inst.castShadow = true; inst.receiveShadow = true; scene.add(inst);
  // park trees
  const trunk = new THREE.CylinderGeometry(0.8, 1.1, 5, 6), crown = new THREE.IcosahedronGeometry(1, 0);
  const tMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2c }), cMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(COL.green).multiplyScalar(0.55), roughness: 0.9, flatShading: true });
  for (let i = 0; i < 46; i++) {
    const px = COLS[5] + 24 + rnd() * (COLS[7] - COLS[5] - 48), py = ROWS[3] + 24 + rnd() * (ROWS[4] - ROWS[3] - 48), s = 5 + rnd() * 5;
    const [x, z] = W3(px, py);
    const t = new THREE.Mesh(trunk, tMat); t.position.set(x, 2.5, z); t.castShadow = true; scene.add(t);
    const c = new THREE.Mesh(crown, cMat); c.scale.setScalar(s); c.position.set(x, 5 + s * 0.8, z); c.castShadow = true; scene.add(c);
  }
  // bridges: railings
  const railMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(COL['paint-2']) });
  for (const e of edges) if (/Bridge/.test(e.name)) {
    const A = nodes[e.a], B = nodes[e.b];
    for (const o of [-12, 12]) { const [x, z] = W3(A.x + o, (A.y + B.y) / 2); const r = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3, B.y - A.y - 28), railMat); r.position.set(x, 1.5, z); r.castShadow = true; scene.add(r); }
  }
  // depots: chargers
  const postGeo = new THREE.BoxGeometry(3, 9, 3), postMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(COL.green), emissive: new THREE.Color(COL.green), emissiveIntensity: 0.25 });
  for (const dp of DEPOTS) { const N = nodes[dp.node]; for (let k = 0; k < 3; k++) { const [x, z] = W3(N.x + dp.ox + 10 + k * 20, N.y + dp.oy + 3); const p = new THREE.Mesh(postGeo, postMat); p.position.set(x, 4.5, z); p.castShadow = true; scene.add(p); } }
  // HQ tower at Canal & Dock, the Executor
  { const [x, z] = W3(COLS[3] + 60, ROWS[1] + 55); const hq = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 70, 8), new THREE.MeshStandardMaterial({ color: new THREE.Color(COL.road), roughness: 0.6 })); hq.position.set(x, 35, z); hq.castShadow = true; scene.add(hq);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(9.3, 9.3, 3, 8), new THREE.MeshStandardMaterial({ color: new THREE.Color(COL.yellow), emissive: new THREE.Color(COL.yellow), emissiveIntensity: 0.5 })); band.position.set(x, 64, z); scene.add(band); MAT.hqBand = band.material; }

  // shared materials
  for (const k of ['paint', 'paint-2', 'yellow', 'red', 'orange', 'green', 'blue', 'road']) MAT[k] = new THREE.MeshStandardMaterial({ color: new THREE.Color(COL[k]), roughness: 0.55 });
  for (const k of ['paint', 'paint-2', 'yellow', 'red', 'orange', 'green', 'blue']) MAT['lamp-' + k] = new THREE.MeshStandardMaterial({ color: new THREE.Color(COL[k]), emissive: new THREE.Color(COL[k]), emissiveIntensity: 0.9 });
  MAT.glass = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.2, metalness: 0.4 });
  GEO.body = new THREE.BoxGeometry(20, 5, 11); GEO.cabin = new THREE.BoxGeometry(11, 4, 9.5); GEO.lidar = new THREE.CylinderGeometry(2, 2.3, 2.4, 12); GEO.lamp = new THREE.BoxGeometry(3, 1, 9);
  GEO.wheel = new THREE.CylinderGeometry(2.1, 2.1, 1.6, 10); GEO.wheel.rotateX(Math.PI / 2);

  // cars
  for (const c of S.cars) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(GEO.body, MAT.paint); body.position.y = 4.6; body.castShadow = true; g.add(body);
    const cab = new THREE.Mesh(GEO.cabin, MAT.glass); cab.position.set(-1, 9, 0); cab.castShadow = true; g.add(cab);
    const lid = new THREE.Mesh(GEO.lidar, MAT.road); lid.position.set(-1, 12.2, 0); g.add(lid);
    const lamp = new THREE.Mesh(GEO.lamp, MAT['lamp-paint-2']); lamp.position.set(-7, 7.6, 0); g.add(lamp);
    for (const [wx, wz] of [[6.5, 5.6], [6.5, -5.6], [-6.5, 5.6], [-6.5, -5.6]]) { const w = new THREE.Mesh(GEO.wheel, MAT.road); w.position.set(wx, 2.1, wz); g.add(w); }
    g.traverse((m) => (m.userData.car = c));
    scene.add(g);
    // route ribbon
    const max = 80;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6 * 3), 3));
    const rmat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    const ribbon = new THREE.Mesh(geo, rmat); ribbon.renderOrder = 2; ribbon.frustumCulled = false; scene.add(ribbon);
    const tag = document.createElement('span'); tag.className = 'tag3d'; tag.textContent = c.num; tagLayer.append(tag);
    carMeshes.set(c, { g, body, lamp, ribbon, rmat, max, tag });
  }
  ringMesh = new THREE.Mesh(new THREE.TorusGeometry(17, 1.3, 8, 40), MAT['lamp-yellow']); ringMesh.rotation.x = Math.PI / 2; ringMesh.visible = false; scene.add(ringMesh);
  pinGroup = new THREE.Group(); scene.add(pinGroup);
  incGroup = new THREE.Group(); scene.add(incGroup);
  trafficGroup = new THREE.Group(); scene.add(trafficGroup);
  hoverMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 22), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false })); hoverMesh.visible = false; scene.add(hoverMesh);
  GEO.pin = new THREE.ConeGeometry(4, 10, 14); GEO.pin.rotateX(Math.PI); GEO.pinHead = new THREE.SphereGeometry(5, 16, 12); GEO.drop = new THREE.OctahedronGeometry(4.5);
  GEO.cone = new THREE.ConeGeometry(2.4, 7, 10); GEO.sign = new THREE.ConeGeometry(9, 2, 3); GEO.sign.rotateX(Math.PI / 2); GEO.post = new THREE.CylinderGeometry(0.8, 0.8, 14, 6);
  GEO.overlay = new THREE.BoxGeometry(1, 0.6, 21);
  MAT.overlayRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.red), transparent: true, opacity: 0.55, depthWrite: false });
  MAT.overlayOrange = new THREE.MeshBasicMaterial({ color: new THREE.Color(COL.orange), transparent: true, opacity: 0.4, depthWrite: false });

  setupPointer();
  new ResizeObserver(resize3D).observe(host); resize3D();
}
function resize3D() {
  const host = $('three'); const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (!resize3D.done) { resize3D.done = true; camera.position.copy(viewPos('tilt')); controls.update(); }
}
function edgeBox(mesh, e, y = 0.4) {
  const A = nodes[e.a], B = nodes[e.b]; const [x, z] = W3((A.x + B.x) / 2, (A.y + B.y) / 2);
  mesh.position.set(x, y, z); mesh.scale.set(e.len, 1, 1); mesh.rotation.y = A.y === B.y ? 0 : Math.PI / 2;
}
function showHover(e) {
  if (!e) { hoverMesh.visible = false; return; }
  hoverMesh.material.color.set(S.tool === 'crash' ? COL.red : COL.orange);
  edgeBox(hoverMesh, e, 1); hoverMesh.scale.y = 1.5; hoverMesh.visible = true;
  $('hint').textContent = e.name;
}
const ROUTE_COL = { pickup: 'blue', riding: 'yellow', tocharge: 'green', reposition: 'paint', hold: 'orange' };
const LAMP = { idle: 'paint-2', pickup: 'blue', riding: 'yellow', tocharge: 'green', charging: 'green', reposition: 'paint', hold: 'orange', stranded: 'red' };
function carPos(c) {
  if (c.seg >= c.path.length - 1 || c.prog === 0) { const n = nodes[c.path[c.seg]]; return { x: n.x, y: n.y, ang: c.ang }; }
  const A = nodes[c.path[c.seg]], B = nodes[c.path[c.seg + 1]], e = E(A.id, B.id), f = c.prog / e.len;
  return { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, ang: Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI };
}
function laneOffset(x1, y1, x2, y2, o) { const L = Math.hypot(x2 - x1, y2 - y1) || 1; return [-(y2 - y1) / L * o, (x2 - x1) / L * o]; }
const vTmp = window.THREE ? new THREE.Vector3() : null;
function placeTag(el, x, y, z) {
  vTmp.set(x, y, z).project(camera);
  if (vTmp.z > 1) { el.style.visibility = 'hidden'; return; }
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  el.style.visibility = 'visible';
  el.style.transform = `translate(${((vTmp.x + 1) / 2 * w).toFixed(1)}px, ${((1 - vTmp.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
}
function writeRibbon(m, pts, drawn) {
  const pos = m.ribbon.geometry.attributes.position.array; let n = 0, acc = 0; const hw = 2.6;
  for (let i = 1; i < pts.length && n < m.max * 6; i++) {
    const [ax, az] = pts[i - 1]; let [bx, bz] = pts[i];
    const seg = Math.hypot(bx - ax, bz - az); if (seg < 0.01) continue;
    if (acc + seg > drawn) { const f = (drawn - acc) / seg; bx = ax + (bx - ax) * f; bz = az + (bz - az) * f; }
    const nx = -(bz - az) / seg * hw, nz = (bx - ax) / seg * hw, ex = (bx - ax) / seg * hw, ez = (bz - az) / seg * hw;
    const a1 = [ax - nx - ex, az - nz - ez], a2 = [ax + nx - ex, az + nz - ez], b1 = [bx - nx + ex, bz - nz + ez], b2 = [bx + nx + ex, bz + nz + ez];
    for (const p of [a1, b1, a2, a2, b1, b2]) { pos.set([p[0], 0.9, p[1]], n * 3); n++; }
    acc += seg; if (acc >= drawn) break;
  }
  m.ribbon.geometry.setDrawRange(0, n); m.ribbon.geometry.attributes.position.needsUpdate = true;
}
function renderMap(now) {
  if (!has3D) return;
  for (const c of S.cars) {
    const m = carMeshes.get(c);
    const p = carPos(c);
    let ox = 0, oy = 0;
    if (c.seg < c.path.length - 1) { const A = nodes[c.path[c.seg]], B = nodes[c.path[c.seg + 1]]; [ox, oy] = laneOffset(A.x, A.y, B.x, B.y, 5); }
    let da = p.ang - c.ang; while (da > 180) da -= 360; while (da < -180) da += 360;
    c.ang += da * 0.25; c.x = p.x; c.y = p.y;
    const [x, z] = W3(p.x + ox, p.y + oy);
    m.g.position.set(x, 0, z); m.g.rotation.y = -c.ang * Math.PI / 180;
    m.lamp.material = MAT['lamp-' + (LAMP[c.state] || 'paint-2')];
    m.body.material = c.state === 'stranded' ? MAT.red : (m.bodyMat || MAT.paint);
    placeTag(m.tag, x, 20, z);
    m.tag.dataset.sel = String(S.selected === c);
    // route
    const st = c.state === 'hold' ? 'hold' : c.state;
    const moving = c.seg < c.path.length - 1 && ROUTE_COL[st];
    if (!moving) { m.ribbon.visible = false; continue; }
    const pts = [[x, z]];
    for (let i = c.seg + 1; i < c.path.length; i++) {
      const A = nodes[c.path[i - 1]], B = nodes[c.path[i]];
      const [qx, qy] = laneOffset(A.x, A.y, B.x, B.y, 5);
      const C = i + 1 < c.path.length ? nodes[c.path[i + 1]] : null;
      let px, py;
      if (C) { const [sx, sy] = laneOffset(B.x, B.y, C.x, C.y, 5); px = B.x + (qx + sx) / 2; py = B.y + (qy + sy) / 2; } else { px = B.x + qx; py = B.y + qy; }
      pts.push(W3(px, py));
    }
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const k = reduceMotion ? 1 : Math.min(1, (now - c.drawT) / 700);
    writeRibbon(m, pts, L * (1 - Math.pow(1 - k, 3)));
    m.rmat.color.set(COL[ROUTE_COL[st]]);
    m.rmat.opacity = S.selected && S.selected !== c ? 0.22 : 0.95;
    m.ribbon.visible = true;
  }
  const sel = S.selected || S.hoverCar;
  if (sel) { const m = carMeshes.get(sel); ringMesh.visible = true; ringMesh.position.set(m.g.position.x, 1.2, m.g.position.z); ringMesh.material = sel.state === 'stranded' ? MAT['lamp-red'] : MAT['lamp-yellow']; } else ringMesh.visible = false;
  // pins bob, incident tags follow camera
  const t = now / 1000;
  pinGroup.children.forEach((o, i) => { if (o.userData.bob) o.position.y = o.userData.base + (reduceMotion ? 0 : Math.sin(t * 2.2 + i) * 1.6); });
  incGroup.children.forEach((o) => { if (o.userData.tag) { const w = o.userData.w; placeTag(o.userData.tag, w[0], 26, w[1]); } });
  if (MAT.hqBand) MAT.hqBand.emissiveIntensity = S.agent ? 0.9 + (reduceMotion ? 0 : Math.sin(t * 3) * 0.25) : 0.25;
  // camera follow
  if (viewMode === 'follow' && S.selected) {
    const m = carMeshes.get(S.selected).g; const a = m.rotation.y;
    const want = new THREE.Vector3(m.position.x - Math.cos(-a) * 85, 150, m.position.z - Math.sin(-a) * 85);
    camera.position.lerp(want, 0.06); controls.target.lerp(m.position, 0.15);
  } else if (camFly) {
    const k2 = Math.min(1, (now - camFly.t0) / 900), e2 = 1 - Math.pow(1 - k2, 3);
    camera.position.lerpVectors(camFly.p0, camFly.p1, e2); controls.target.lerpVectors(camFly.q0, camFly.q1, e2);
    if (k2 >= 1) camFly = null;
  }
  controls.update();
  renderer.render(scene, camera);
}
let camFly = null;
function viewPos(mode) {
  const half = THREE.MathUtils.degToRad(camera.fov / 2);
  const fit = Math.max(380 / Math.tan(half), (camera.aspect < 1.4 ? 450 : 520) / (Math.tan(half) * camera.aspect));
  return mode === 'top' ? new THREE.Vector3(0, fit, 1) : new THREE.Vector3(-30, fit * 0.56, fit * 0.62);
}
function setView(mode) {
  if (!has3D) return;
  if (mode === 'follow' && !S.selected) { toast('Select a car in the fleet list or on the map first'); return; }
  viewMode = mode;
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === mode)));
  if (mode === 'follow') return;
  const p1 = viewPos(mode);
  camFly = { t0: performance.now(), p0: camera.position.clone(), p1, q0: controls.target.clone(), q1: new THREE.Vector3(0, 0, mode === 'top' ? 0 : 20) };
  if (reduceMotion) { camera.position.copy(p1); controls.target.copy(camFly.q1); camFly = null; }
}
function clearGroup(g) { while (g.children.length) { const o = g.children.pop(); if (o.userData.tag) o.userData.tag.remove(); if (o.userData.ownGeo) o.geometry.dispose(); } }
function renderPins() {
  if (!has3D) return;
  clearGroup(pinGroup);
  const add = (n, kind, col, mine) => {
    const N = nodes[n]; const [x, z] = W3(N.x + (kind === 'pin' ? 12 : -12), N.y + (kind === 'pin' ? -12 : 12));
    if (kind === 'pin') {
      const g = new THREE.Group(); const c = new THREE.Mesh(GEO.pin, MAT['lamp-' + col]); c.position.y = 5; const h = new THREE.Mesh(GEO.pinHead, MAT['lamp-' + col]); h.position.y = 12; g.add(c, h);
      if (mine) { const r = new THREE.Mesh(GEO.pinHead, MAT['lamp-paint']); r.scale.setScalar(0.45); r.position.y = 12; r.position.x = 4.2; g.add(r); }
      g.position.set(x, 4, z); g.userData = { bob: true, base: 4 }; pinGroup.add(g);
    } else { const d = new THREE.Mesh(GEO.drop, MAT['lamp-' + col]); d.position.set(x, 6, z); pinGroup.add(d); }
  };
  for (const r of S.reqs) {
    if (r.status === 'waiting' || r.status === 'assigned') add(r.from, 'pin', 'blue', r.mine);
    if (r.status === 'riding') add(r.to, 'drop', 'yellow');
    else if (r.status === 'assigned' || (r.mine && r.status === 'waiting')) add(r.to, 'drop', 'blue');
  }
  if (S.rideDraft != null) add(S.rideDraft, 'pin', 'paint');
}
function renderIncidents() {
  if (!has3D) return;
  clearGroup(trafficGroup); clearGroup(incGroup);
  for (const e of edges) {
    if (e.traffic <= 1.05 || e.blocked) continue;
    const m = new THREE.Mesh(GEO.overlay, MAT.overlayOrange.clone()); m.userData.ownGeo = false;
    m.material.opacity = Math.min(0.7, (e.traffic - 1) / 3); edgeBox(m, e, 0.5); trafficGroup.add(m);
  }
  for (const inc of S.incidents) {
    const e = inc.edge, A = nodes[e.a], B = nodes[e.b]; const hz = A.y === B.y;
    const g = new THREE.Group();
    if (inc.type === 'crash') {
      const o = new THREE.Mesh(GEO.overlay, MAT.overlayRed); edgeBox(o, e, 0.55); incGroup.add(o);
      const post = new THREE.Mesh(GEO.post, MAT.road); post.position.y = 7; g.add(post);
      const sign = new THREE.Mesh(GEO.sign, MAT['lamp-red']); sign.position.y = 18; g.add(sign);
      for (const d of [-14, 14]) { const cone = new THREE.Mesh(GEO.cone, MAT['lamp-orange']); cone.position.set(hz ? d : 0, 3.5, hz ? 0 : d); g.add(cone); }
    } else {
      for (let d = -e.len / 2 + 14; d < e.len / 2 - 10; d += 16) { const cone = new THREE.Mesh(GEO.cone, MAT['lamp-orange']); cone.position.set(hz ? d : 7, 3.5, hz ? 7 : d); g.add(cone); }
    }
    const [x, z] = W3(e.mx, e.my); g.position.set(x, 0, z);
    g.traverse((o) => (o.castShadow = true));
    const tag = document.createElement('span'); tag.className = 'tag3d inc'; tag.dataset.kind = inc.type; tag.textContent = Math.ceil((inc.until - S.t) / 60) + ' min'; tagLayer.append(tag);
    g.userData = { tag, w: [x, z] }; placeTag(tag, x, 26, z);
    incGroup.add(g);
  }
  for (const dp of DEPOTS) { /* charging count is shown in the fleet list */ }
}
function groundPoint(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  const v = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(v, camera);
  const carHit = raycaster.intersectObjects([...carMeshes.values()].map((m) => m.g), true)[0];
  const gh = raycaster.intersectObject(ground)[0];
  return { car: carHit?.object.userData.car, p: gh ? { x: gh.point.x + 490, y: gh.point.z + 345 } : null };
}
function nearestEdge(p) {
  let best = null, bd = 18;
  for (const e of edges) {
    const A = nodes[e.a], B = nodes[e.b]; const dx = B.x - A.x, dy = B.y - A.y; const t = Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(p.x - (A.x + dx * t), p.y - (A.y + dy * t)); if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function setupPointer() {
  const cv = renderer.domElement; let down = null;
  cv.addEventListener('pointerdown', (ev) => (down = { x: ev.clientX, y: ev.clientY }));
  cv.addEventListener('pointermove', (ev) => {
    if (S.tool !== 'crash' && S.tool !== 'jam') return;
    const { p } = groundPoint(ev); showHover(p ? nearestEdge(p) : null);
  });
  cv.addEventListener('pointerleave', () => showHover(null));
  cv.addEventListener('pointerup', (ev) => {
    if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 5) return;
    const { car, p } = groundPoint(ev);
    if (S.tool === 'none') { select(car ?? null); if (!car && viewMode === 'follow') setView('tilt'); return; }
    if (!p) return;
    if (S.tool === 'crash' || S.tool === 'jam') { const e = nearestEdge(p); if (e) { addIncident(S.tool, e); showHover(null); } return; }
    let best = 0, bd = 1e9; for (const n of nodes) { if (!adj[n.id].length) continue; const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = n.id; } }
    if (S.rideDraft == null) { S.rideDraft = best; renderPins(); $('hint').textContent = `Pickup at ${corner(best)}. Now click your destination.`; return; }
    if (best === S.rideDraft) { toast('Pick a destination at least a block away'); return; }
    const r = spawnRequest(S.rideDraft, best, true);
    log({ src: 'exec', kind: 'system', tag: 'Request', head: `${r.id} You: ${corner(r.from)} → ${corner(r.to)}`, body: 'Your ride request is in the queue.' });
    toast(`Ride requested from ${corner(r.from)}`);
    S.rideDraft = null; setTool('ride'); S.timers.dispatch = S.t;
  });
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
}
