// Background traffic for the RobroTaxi pages: cars, vans and buses that drive every road, so a slow road has a visible reason.
// Nothing here is simulated: each road's density and speed come from the sim's own per-road traffic multiplier (edge.traffic,
// set by recomputeTraffic from the time of day and from incidents), and positions are a pure function of sim time, so the
// same seed and clock always draw the same traffic. Robotaxis slow down on the same multiplier, which is why they crawl in a queue.
// Injected by server.js after live.js. Self-contained so the 3D art can change around it: it only needs
// window.__robroLiveHooks (main, nodes, edges, edgeAt, BASE and, in 3D, scene and W3) and the global THREE.
(() => {
  const H = window.__robroLiveHooks;
  if (!H || !H.edgeAt || !H.BASE) return;
  const scene = H.scene, W3 = H.W3;
  const is3d = typeof THREE !== 'undefined' && !!scene && typeof W3 === 'function';
  const svg = !is3d && document.getElementById('gRoutes');
  if (!is3d && !svg) return;

  const fr = (x) => x - Math.floor(x);
  const hash = (n) => fr(Math.sin(n * 127.1 + 311.7) * 43758.5453);
  const LANE = 0.45;
  const MAXSLOT = 28;

  // one group per road and direction of travel
  const groups = [];
  for (const e of H.edges) {
    const arterial = !e.motorway && e.kmh >= 50;
    const free = e.motorway ? 24 : arterial ? 20 : e.kmh >= 40 ? 12 : 5; // vehicles per km per direction on a quiet day
    for (const fwd of e.oneway ? [true] : [true, false]) {
      groups.push({ e, from: fwd ? e.a : e.b, free, wide: arterial || e.motorway, off: 0, n: 0, q: 0, v: 0, h0: hash(e.id * 2 + (fwd ? 0 : 1)), crash: false });
    }
  }

  const KINDS = [{ len: 4.4, wid: 1.8, hgt: 1.5 }, { len: 5.4, wid: 2.0, hgt: 2.3 }, { len: 11, wid: 2.5, hgt: 3.1 }];
  const kindOf = (g, k) => { const r = hash(g.e.id * 977 + k * 13 + (g.from === g.e.a ? 1 : 2)); return r < 0.74 ? 0 : r < 0.93 || !g.wide ? 1 : 2; };

  let active = []; // [group, slot] pairs drawn this refresh
  function refresh() {
    active = [];
    for (const g of groups) {
      const e = g.e, L = e.len, tr = e.traffic || 1;
      g.crash = !!e.blocked;
      g.q = tr >= 1.8 ? Math.min(1, 0.25 + 0.5 * (1 - 1 / tr)) : 0; // share of the road a queue fills, at the downstream end
      const rho = Math.max(g.free * (0.45 + 0.55 * Math.min(1, (tr - 1))), 110 * (1 - 1 / tr)); // per km
      let n = g.crash ? 3 : Math.min(MAXSLOT, Math.floor(rho * L / 100 + g.h0));
      g.n = n; g.v = g.crash ? 0 : H.BASE * e.spd / tr * (g.q ? 0.5 : 1);
      for (let k = 0; k < n; k++) active.push(g, k);
    }
  }

  // sim time, smoothed between snapshots so vehicles move every frame
  let lastT = null, lastAt = 0, rate = 0, tv = 0, prevTv = 0;
  function clock(now) {
    const t = H.main().t;
    if (lastT == null) { lastT = t; lastAt = now; tv = prevTv = t; return 0; }
    if (t !== lastT) { const dt = (now - lastAt) / 1000; if (dt > 0.02 && t > lastT) rate = Math.min(500, (t - lastT) / dt); else if (t < lastT) tv = t; lastT = t; lastAt = now; }
    prevTv = tv; tv = Math.max(tv, Math.min(lastT + Math.min((now - lastAt) / 1000, 0.3) * rate, lastT + 60));
    if (tv < lastT - 5) tv = lastT; // a fresh game started
    return Math.max(0, tv - prevTv);
  }

  // where a slot is right now: distance along its road from its start node, then the pose
  const pose = (g, k) => {
    const e = g.e, L = e.len, ph = fr(k * 0.6180339887 + g.h0);
    let s;
    if (g.crash) s = L * 0.5 + (k - 1) * 0.55;
    else if (g.q) { const Q = L * g.q; s = L - Q + fr(ph + g.off / Q) * Q; }
    else s = fr(ph + g.off / L) * L;
    const p = H.edgeAt(e, g.from, Math.max(0, Math.min(L, s)));
    const a = p.ang * Math.PI / 180, lane = (e.oneway && !e.motorway ? 0.5 : 1) * LANE * (g.wide && (k & 1) ? 2 : 1);
    return { x: p.x - Math.sin(a) * lane, y: p.y + Math.cos(a) * lane, a, fade: g.crash ? 1 : Math.min(1, s / 0.8, (L - s) / 0.8) };
  };
  const advance = (dtSim) => { if (dtSim <= 0) return; for (const g of groups) if (g.n && g.v) g.off += g.v * dtSim; };

  let last = 0, nextRefresh = 0;
  if (is3d) {
    // low-poly instanced boxes: a body and a cabin per vehicle, three meshes (cars, vans, buses), one draw call each
    const box = (w, h, d, y, z0) => { const b = new THREE.BoxGeometry(w, h, d).toNonIndexed(); b.translate(z0 || 0, y, 0); return b; };
    const merge = (parts) => {
      const pos = [], nor = [];
      for (const p of parts) { pos.push(...p.attributes.position.array); nor.push(...p.attributes.normal.array); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      return g;
    };
    const mk = (K, cap, cabin) => {
      const geo = merge([box(K.len, K.hgt * (cabin ? 0.5 : 0.85), K.wid, K.hgt * (cabin ? 0.25 : 0.425) + 0.25), ...(cabin ? [box(K.len * 0.55, K.hgt * 0.42, K.wid * 0.9, K.hgt * 0.5 + 0.25 + K.hgt * 0.21, -K.len * 0.05)] : [])]);
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2a2d33 }), cap);
      m.frustumCulled = false; m.count = 0; m.renderOrder = 1; scene.add(m);
      const pal = [0xf1f1ee, 0xf1f1ee, 0x1d2026, 0x1d2026, 0xa8adb6, 0xb23a3a, 0x3a64b0, 0x2f7d55, 0xd9d3c3, 0x5a606b];
      for (let i = 0; i < cap; i++) m.setColorAt(i, new THREE.Color(K === KINDS[2] ? 0xd9b13c : pal[Math.floor(hash(i * 3.1 + cap) * pal.length)]));
      m.instanceColor.needsUpdate = true;
      return m;
    };
    const meshes = [mk(KINDS[0], 9000, true), mk(KINDS[1], 3000, false), mk(KINDS[2], 700, false)];
    const n3 = [0, 0, 0];
    const draw = () => {
      n3[0] = n3[1] = n3[2] = 0;
      for (let i = 0; i < active.length; i += 2) {
        const g = active[i], k = active[i + 1], kind = kindOf(g, k);
        const m = meshes[kind], idx = n3[kind]; if (idx >= m.instanceMatrix.count) continue;
        n3[kind]++;
        const p = pose(g, k), [x, z] = W3(p.x, p.y), c = Math.cos(-p.a), s = Math.sin(-p.a), sc = p.fade;
        const a = m.instanceMatrix.array, o = idx * 16;
        a[o] = c * sc; a[o + 1] = 0; a[o + 2] = -s * sc; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = sc; a[o + 6] = 0; a[o + 7] = 0;
        a[o + 8] = s * sc; a[o + 9] = 0; a[o + 10] = c * sc; a[o + 11] = 0; a[o + 12] = x; a[o + 13] = 0; a[o + 14] = z; a[o + 15] = 1;
      }
      for (let i = 0; i < 3; i++) { meshes[i].count = n3[i]; meshes[i].instanceMatrix.needsUpdate = true; }
    };
    var render = draw; // eslint-disable-line no-var
  } else {
    const NS = 'http://www.w3.org/2000/svg';
    const layer = document.createElementNS(NS, 'g'); layer.id = 'gVeh'; layer.setAttribute('pointer-events', 'none');
    svg.parentNode.insertBefore(layer, svg);
    const paths = KINDS.map((K, i) => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('stroke', ['#8d929c', '#a9aeb8', '#d9b13c'][i]); p.setAttribute('stroke-opacity', '.8'); p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-width', String(K.wid / 10 * 1.7)); p.setAttribute('fill', 'none'); layer.append(p); return p;
    });
    var render = () => { // eslint-disable-line no-var
      const d = ['', '', ''];
      for (let i = 0; i < active.length; i += 2) {
        const g = active[i], k = active[i + 1], kind = kindOf(g, k), p = pose(g, k);
        if (p.fade < 0.4) continue;
        const h = KINDS[kind].len / 15, dx = Math.cos(p.a) * h, dy = Math.sin(p.a) * h;
        d[kind] += `M${(p.x - dx).toFixed(2)} ${(p.y - dy).toFixed(2)}L${(p.x + dx).toFixed(2)} ${(p.y + dy).toFixed(2)}`;
      }
      for (let i = 0; i < 3; i++) paths[i].setAttribute('d', d[i]);
    };
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = clock(now);
    if (now >= nextRefresh) { nextRefresh = now + 700; refresh(); }
    advance(dt);
    if (!is3d && now - last < 50) return; // the 2D layer is rebuilt as one string, 20 times a second is plenty
    last = now; render();
  }
  refresh();
  requestAnimationFrame(frame);
  window.__robroTraffic = { stats: () => ({ vehicles: active.length / 2, groups: groups.length }) };
})();
