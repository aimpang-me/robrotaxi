(() => {
  const H = window.__robroTrafficHooks;
  if (!H) return;
  const is3d = !!H.scene && typeof THREE !== 'undefined';
  const models = {
    sedan: { l: 4.4, w: 1.8, h: 1.48, rear: -.31, front: .18 },
    hatch: { l: 4, w: 1.76, h: 1.55, rear: -.39, front: .16 },
    suv: { l: 4.8, w: 1.95, h: 1.85, rear: -.36, front: .2 },
    van: { l: 5.4, w: 2, h: 2.3, rear: -.44, front: .29 },
    bus: { l: 11, w: 2.5, h: 3.1, rear: -.46, front: .43 },
  };
  const pose = (v) => {
    const e = H.E(v.path[v.seg], v.path[v.seg + 1]);
    const p = v.livePos || (e ? H.edgeAt(e, v.path[v.seg], v.prog) : v);
    const a = p.ang * Math.PI / 180, lane = e && !e.oneway ? .45 : 0;
    return { x: p.x - Math.sin(a) * lane, y: p.y + Math.cos(a) * lane, a, deck: e?.elevated ? 9.9 : 0 };
  };
  let draw;
  if (is3d) {
    const merge = (parts) => {
      const positions = [], normals = [], colors = [];
      for (const [source, hex] of parts) {
        const g = source.index ? source.toNonIndexed() : source;
        positions.push(...g.attributes.position.array); normals.push(...g.attributes.normal.array);
        const c = new THREE.Color(hex).convertSRGBToLinear();
        for (let i = 0; i < g.attributes.position.count; i++) colors.push(c.r, c.g, c.b);
        g.dispose(); if (g !== source) source.dispose();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); return g;
    };
    const box = (x, y, z, w, h, d) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
    const profile = (points, width, bevel = 0) => {
      const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: width, steps: 1, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
      g.translate(0, 0, -width / 2); return g;
    };
    const geometry = (k) => {
      const { l, w, h } = k, belt = h * (l > 8 ? .51 : .56), rear = k.rear * l, front = k.front * l;
      const paint = [[profile([[-l / 2, .32], [-l / 2, belt * .8], [-l * .42, belt], [l * .41, belt], [l / 2, belt * .79], [l / 2, .32]], w * .97, .035), '#ffffff']];
      const trim = [[profile([[rear, belt], [rear + l * .1, h - .13], [front - l * .13, h - .13], [front, belt]], w * .86), '#263b43']];
      paint.push([box((rear + front) / 2, h - .1, 0, front - rear - l * .2, .15, w * .86), '#ffffff']);
      for (const z of [-w * .44, w * .44]) {
        for (const x of [rear + l * .11, front - l * .14, (rear + front) / 2]) paint.push([box(x, (belt + h - .1) / 2, z, .07, h - belt - .1, .055), '#ffffff']);
        if (l > 8) for (let x = rear + 1.2; x < front - .5; x += 1.25) paint.push([box(x, (belt + h) / 2, z, .075, h - belt, .06), '#ffffff']);
        else trim.push([box(front - .15, belt + .08, z * 1.11, .24, .13, .16), '#363937']);
        for (const x of [-l * .31, l * .31]) {
          const radius = l > 8 ? .48 : .32;
          const tire = new THREE.CylinderGeometry(radius, radius, .2, 12); tire.rotateX(Math.PI / 2); tire.translate(x, radius, z); trim.push([tire, '#171b1c']);
          const hub = new THREE.CylinderGeometry(radius * .58, radius * .58, .215, 10); hub.rotateX(Math.PI / 2); hub.translate(x, radius, z); trim.push([hub, '#a5aaa6']);
        }
      }
      trim.push([box(l / 2 + .025, belt * .7, 0, .06, .13, w * .68), '#eee9cd'], [box(-l / 2 - .025, belt * .7, 0, .06, .12, w * .7), '#bd3a31']);
      for (const x of [-l / 2, l / 2]) trim.push([box(x, .36, 0, .1, .12, w * .9), '#4b504d']);
      return [merge(paint), merge(trim), box(l / 2 + .07, belt * .7, 0, .1, .1, w * .68), box(-l / 2 - .07, belt * .7, 0, .1, .1, w * .7)];
    };
    const painted = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: .32, roughness: .42 });
    const details = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .64, metalness: .12 });
    const frontLamp = new THREE.MeshBasicMaterial({ color: 0xf4f5df, fog: false, transparent: true, opacity: 0, depthWrite: false });
    const rearLamp = new THREE.MeshBasicMaterial({ color: 0xea3030, fog: false, transparent: true, opacity: 0, depthWrite: false });
    const pools = new Map(), matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scale = new THREE.Vector3(1, 1, 1), color = new THREE.Color();
    const poolFor = (model, count) => {
      let p = pools.get(model); if (p && p.capacity >= count) return p;
      const capacity = Math.max(32, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
      const geos = p ? p.meshes.map((m) => m.geometry) : geometry(models[model]);
      if (p) for (const m of p.meshes) { H.scene.remove(m); m.dispose(); }
      const meshes = geos.map((g, i) => {
        const m = new THREE.InstancedMesh(g, [painted, details, frontLamp, rearLamp][i], capacity);
        m.name = `traffic-${model}-${['paint', 'details', 'front-lamps', 'rear-lamps'][i]}`; m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.castShadow = i < 2; m.receiveShadow = i < 2; H.scene.add(m); return m;
      });
      p = { capacity, meshes }; pools.set(model, p); return p;
    };
    draw = (vehicles) => {
      const lampsVisible = H.night > 0.04;
      frontLamp.opacity = rearLamp.opacity = H.night;
      for (const p of pools.values()) { p.meshes[2].visible = lampsVisible; p.meshes[3].visible = lampsVisible; }
      const byModel = new Map(Object.keys(models).map((k) => [k, []]));
      for (const v of vehicles) byModel.get(models[v.model] ? v.model : 'sedan').push(v);
      for (const [model, list] of byModel) {
        if (!list.length && !pools.has(model)) continue;
        const p = poolFor(model, list.length);
        p.meshes[2].visible = lampsVisible; p.meshes[3].visible = lampsVisible;
        list.forEach((v, i) => {
          const t = pose(v), [x, z] = H.W3(t.x, t.y), s = v.length * 10 / models[model].l;
          pos.set(x, t.deck + .035, z); q.setFromAxisAngle(up, -t.a); scale.set(s, s, s); matrix.compose(pos, q, scale);
          for (const m of p.meshes) m.setMatrixAt(i, matrix);
          p.meshes[0].setColorAt(i, color.set(v.color).convertSRGBToLinear());
        });
        for (const m of p.meshes) { m.count = list.length; m.instanceMatrix.needsUpdate = true; }
        if (p.meshes[0].instanceColor) p.meshes[0].instanceColor.needsUpdate = true;
      }
    };
  } else {
    const routes = document.getElementById('gRoutes'); if (!routes) return;
    const NS = 'http://www.w3.org/2000/svg', layer = document.createElementNS(NS, 'g'), cars = new Map();
    layer.id = 'gVeh'; layer.setAttribute('pointer-events', 'none'); routes.before(layer);
    const make = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent.append(n); return n; };
    draw = (vehicles) => {
      const alive = new Set();
      for (const v of vehicles) {
        alive.add(v.id); let g = cars.get(v.id);
        if (!g) {
          const k = models[v.model] || models.sedan, l = v.length, w = k.w / 10;
          g = make('g', { 'data-vehicle': v.id }, layer);
          make('rect', { x: -l / 2, y: -w / 2, width: l, height: w, rx: .035, fill: v.color, stroke: '#171b1c', 'stroke-width': .02 }, g);
          make('rect', { x: -l * .22, y: -w * .4, width: l * .4, height: w * .8, rx: .015, fill: '#263b43' }, g);
          make('rect', { x: l * .46, y: -w * .34, width: l * .04, height: w * .68, fill: '#eee9cd' }, g); cars.set(v.id, g);
        }
        const p = pose(v); g.setAttribute('transform', `translate(${p.x.toFixed(3)} ${p.y.toFixed(3)}) rotate(${(p.a * 180 / Math.PI).toFixed(2)})`);
      }
      for (const [id, g] of cars) if (!alive.has(id)) { g.remove(); cars.delete(id); }
    };
  }
  function frame() { if (!document.hidden) draw(H.main().traffic?.vehicles || []); requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
})();
