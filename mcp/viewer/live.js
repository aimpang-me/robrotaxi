// Live mode for the RobroTaxi pages: the server's game drives the map; the page only draws.
// Injected by server.js into /view/2d and /view/3d. Needs ?game=<id>.
(() => {
  const id = new URLSearchParams(location.search).get('game');
  const H = window.__robroLiveHooks;
  const is3d = location.pathname.endsWith('/3d');
  // 3D needs three.js from the CDN; if it or the page failed to start, show the same game in 2D
  if (id && is3d && (typeof THREE === 'undefined' || !H)) { location.replace('/view/2d' + location.search); return; }
  if (!id || !H) return;
  window.__robroLive = true;

  const css = document.createElement('style');
  css.textContent = `
#robroHud{position:fixed;left:16px;bottom:16px;z-index:9999;display:grid;gap:6px;width:min(250px,calc(100vw - 32px));
  padding:10px 12px;border-radius:12px;background:rgba(18,20,24,.94);color:#f2f0e8;font:500 13px/1.3 Overpass,system-ui,sans-serif;
  box-shadow:0 6px 24px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.1)}
#robroHud .who{display:grid}#robroHud .bar{width:100%!important}
#robroHud b{font-weight:800}#robroHud .mono{font-family:'Overpass Mono',ui-monospace,monospace}
#robroHud .live{color:#121418;background:#f5c518;border-radius:6px;padding:1px 7px;font-weight:800;letter-spacing:.06em;font-size:11px}
#robroHud .bar{width:140px;height:8px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden}
#robroHud .bar i{display:block;height:100%;background:#f5c518;width:0}
#robroHud[data-done=true] .live{background:#3ecf6e}
#robroHud .muted{opacity:.7}
#robroHud .sw{margin-left:auto;color:#f2f0e8;opacity:.8;font-size:12px;font-weight:700;text-decoration:none;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:1px 7px}
#robroHud .sw:hover{opacity:1;border-color:#f5c518}
#robroHud .top{display:flex;align-items:center;gap:6px}`;
  document.head.append(css);
  const hud = document.createElement('div'); hud.id = 'robroHud';
  hud.innerHTML = '<span class="top"><span class="live">LIVE</span> <span class="mono time muted"></span><a class="sw"></a></span><span class="who">Connecting to HQ…</span><span class="mono rev"></span><span class="bar"><i></i></span>';
  document.body.append(hud);
  const $h = (s) => hud.querySelector(s);
  const sw = $h('.sw'); sw.textContent = is3d ? 'View 2D' : 'View 3D'; sw.href = (is3d ? '/view/2d' : '/view/3d') + location.search;
  const money = (x) => '$' + Math.round(x).toLocaleString('en-US');

  /* ---- smooth motion: the server sends about 10 updates a second; between them each car glides
     along its route at the display frame rate, and corners are rounded ---- */
  const motion = new Map(); // car id -> { path, cum, from, to, t0, dur, ang, off }
  let lastAt = 0, gap = 120;
  const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const cumOf = (path) => { const c = [0]; for (let i = 1; i < path.length; i++) c.push(c[i - 1] + (H.E(path[i - 1], path[i])?.len || 0)); return c; };
  const segAt = (cum, d) => { let i = 0; while (i < cum.length - 2 && cum[i + 1] <= d) i++; return i; };
  function retarget(m, sc, now) {
    const P = sc.path, cumP = cumOf(P), dT = cumP[Math.min(sc.seg, P.length - 1)] + (sc.seg < P.length - 1 ? sc.prog : 0);
    const cur = m.from + (m.to - m.from) * Math.min(1, (now - m.t0) / m.dur);
    let path = P, cum = cumP, from = dT, to = dT;
    if (sameArr(m.path, P)) { if (dT >= cur - 0.5) from = cur; }
    else if (m.path.length) {
      // find where the car is drawn now on the new route, or join the old route onto it
      const i = segAt(m.cum, cur), q = cur - m.cum[i], A = m.path[i], B = m.path[i + 1], atNode = q < 0.01 || B == null;
      const node = atNode ? A : (q >= m.cum[i + 1] - m.cum[i] - 0.01 ? B : null);
      let k = -1;
      if (node == null) { for (let j = 0; j < P.length - 1; j++) if (P[j] === A && P[j + 1] === B) { k = j; break; } if (k >= 0) from = cumP[k] + q; }
      else { k = P.indexOf(node); if (k >= 0) from = cumP[k]; }
      if (k >= 0 && from > dT + 0.5) from = dT;
      if (k < 0) {
        let j = -1; for (let x = node === A ? i : i + 1; x < m.path.length; x++) if (m.path[x] === P[0]) { j = x; break; }
        if (j >= 0) { path = m.path.slice(0, j).concat(P); cum = cumOf(path); from = cur; to = cum[j] + dT; }
      }
    }
    Object.assign(m, { path, cum, from, to, t0: now, dur: Math.min(1000, gap * 1.15) });
  }
  // pose at distance d: centreline point with rounded corners, heading, then the right-hand lane offset
  function poseOf(m, d) {
    const { path, cum } = m, N = H.nodes;
    if (path.length < 2) return null;
    const i = segAt(m.cum, d), A = N[path[i]], B = N[path[i + 1]];
    const L = cum[i + 1] - cum[i] || 1, f = Math.max(0, Math.min(1, (d - cum[i]) / L));
    let x = A.x + (B.x - A.x) * f, y = A.y + (B.y - A.y) * f, dx = B.x - A.x, dy = B.y - A.y;
    const R = 14;
    // near the start node of this edge (coming out of a turn) or near its end node (going into one)
    const corner = (j) => { // corner at path[j], between edge j-1 and edge j
      if (j <= 0 || j >= path.length - 1) return null;
      const P0n = N[path[j - 1]], C = N[path[j]], P2n = N[path[j + 1]];
      const ax = C.x - P0n.x, ay = C.y - P0n.y, bx = P2n.x - C.x, by = P2n.y - C.y, la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
      const dot = (ax * bx + ay * by) / la / lb; if (dot > 0.98 || dot < -0.98) return null;
      const ra = Math.min(R, la / 2), rb = Math.min(R, lb / 2), s0 = cum[j] - ra, s1 = cum[j] + rb;
      if (d < s0 || d > s1) return null;
      const u = d < cum[j] ? 0.5 * (d - s0) / ra : 0.5 + 0.5 * (d - cum[j]) / rb;
      const p0x = C.x - ax / la * ra, p0y = C.y - ay / la * ra, p2x = C.x + bx / lb * rb, p2y = C.y + by / lb * rb, v = 1 - u;
      return { x: v * v * p0x + 2 * v * u * C.x + u * u * p2x, y: v * v * p0y + 2 * v * u * C.y + u * u * p2y,
        dx: 2 * v * (C.x - p0x) + 2 * u * (p2x - C.x), dy: 2 * v * (C.y - p0y) + 2 * u * (p2y - C.y) };
    };
    const r = corner(i) || corner(i + 1);
    if (r) ({ x, y, dx, dy } = r);
    return { x, y, ang: Math.atan2(dy, dx) * 180 / Math.PI };
  }
  function place(c, m, now, dt) {
    const d = m.from + (m.to - m.from) * Math.min(1, (now - m.t0) / m.dur);
    const p = poseOf(m, d);
    const moving = p && d < m.cum[m.cum.length - 1] - 0.01;
    if (p) m.ang = p.ang;
    // ease onto and off the lane when a car pulls away from or stops at an intersection
    m.off += ((moving ? 1 : 0) - m.off) * Math.min(1, dt * 6);
    let x, y;
    if (p) ({ x, y } = p); else { const n = H.nodes[m.path[0]]; x = n.x; y = n.y; }
    const a = (m.ang || 0) * Math.PI / 180;
    c.livePos = { x: x - Math.sin(a) * 5 * m.off, y: y + Math.cos(a) * 5 * m.off, ang: m.ang ?? c.ang };
    const i = m.path.length > 1 ? segAt(m.cum, d) : 0, q = m.path.length > 1 ? d - m.cum[i] : 0;
    c.path = m.path; c.seg = moving ? i : m.path.length - 1; c.prog = moving ? q : 0;
  }
  let lastFrame = performance.now();
  function animate(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
    const S = H.main();
    for (const c of S.cars) { const m = motion.get(c.id); if (m) place(c, m, now, dt); }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  function sync(W, d, smooth) {
    const reqMap = new Map(), now = performance.now();
    W.reqs = d.reqs.map((r) => { const o = { ...r, car: null }; reqMap.set(o.id, o); return o; });
    for (const sc of d.cars) {
      const c = W.cars.find((x) => x.id === sc.id); if (!c) continue;
      if (c.routeVer !== sc.routeVer) c.drawT = now;
      Object.assign(c, { state: sc.state, battery: sc.battery, chargeTo: sc.chargeTo, plugged: sc.plugged,
        queueT: sc.queueT, holdUntil: sc.holdUntil, strandUntil: sc.strandUntil, routeVer: sc.routeVer });
      if (smooth) {
        let m = motion.get(sc.id);
        if (!m) { m = { path: [], cum: [0], from: 0, to: 0, t0: now, dur: 1, ang: c.ang, off: 0 }; motion.set(sc.id, m); }
        retarget(m, sc, now); place(c, m, now, 0);
      } else { delete c.livePos; Object.assign(c, { path: sc.path, seg: sc.seg, prog: sc.prog, x: sc.x, y: sc.y }); }
      c.depot = H.DEPOTS.find((x) => x.name === sc.depot) || null;
      c.job = sc.job ? reqMap.get(sc.job) || null : null; if (c.job) c.job.car = c;
      c.next = sc.next ? reqMap.get(sc.next) || null : null; if (c.next) c.next.car = c;
      c.known = new Set(sc.known);
    }
  }
  let announced = false;
  function apply(meta, snap) {
    const S = H.main();
    Object.assign(S, { t: snap.t, agent: snap.agent, agentSince: snap.agentSince, connectT: snap.connectT, rph: snap.rph, hazIdx: snap.hazIdx, rush: snap.rush, paused: false });
    const at = performance.now(); if (lastAt && at - lastAt < 1500) gap = gap * 0.8 + (at - lastAt) * 0.2; lastAt = at;
    sync(S, snap, true);
    S.periods = snap.periods; S.waitSeries = snap.waitSeries;
    if (snap.shadow) {
      if (!H.shadow()) H.setShadow(H.cloneWorld(S));
      const sh = H.shadow(); sync(sh, snap.shadow); sh.periods = snap.shadow.periods; sh.waitSeries = snap.shadow.waitSeries || [];
    } else H.setShadow(null);
    S.incidents.length = 0;
    for (const i of snap.incidents) S.incidents.push({ ...i, edge: H.edges[i.edge] });
    H.recomputeTraffic();
    const now = S.t;
    for (const e of snap.events) { if (e.kind === 'fare') continue; S.t = e.t; H.log(e); }
    S.t = now;
    H.setAgentUI();
    // HUD
    const sc = snap.score;
    if (!announced) {
      announced = true; document.title = `${meta.player} · ${meta.model} · RobroTaxi live`;
      // the page's own controls would fork the local world from the server's, so they are switched off
      document.querySelectorAll('#connect, .tool, #reseed, #seedIn, #clearInc, #rush, #randomInc, #pause, [data-speed], #wEff, #wBat, #wRr').forEach((el) => { el.disabled = true; el.style.opacity = '.45'; el.style.pointerEvents = 'none'; });
      const set = (sel, text) => { const el = document.getElementById(sel); if (el) { if ('value' in el && el.tagName === 'INPUT') el.value = text; else el.textContent = text; } };
      set('seedIn', String(meta.seed));
      set('seedLabel', `Seed ${meta.seed} · about ${snap.rph} riders/hr · live from HQ`);
      set('agentAddr', `player ${meta.player} · via MCP`);
      const name = document.querySelector('.agent-id b'); if (name) name.textContent = meta.model;
    }
    if (!$h('.who b')) $h('.who').innerHTML = '<b></b><span class="muted"></span>';
    $h('.who b').textContent = meta.player; $h('.who .muted').textContent = `${meta.model} · seed ${meta.seed}${meta.ranked ? ' ranked' : ''}`;
    $h('.rev').textContent = `${money(sc.revenue)} / $1,000,000`;
    $h('.bar i').style.width = Math.max(0, Math.min(100, sc.progress * 100)).toFixed(1) + '%';
    const h = Math.floor(sc.elapsedMin / 60), m = Math.floor(sc.elapsedMin % 60);
    $h('.time').textContent = sc.finished ? `finished in ${(sc.finishMin / 60).toFixed(2)} h` : sc.outOfTime ? 'out of time' : `${h}h ${String(m).padStart(2, '0')}m`;
    hud.dataset.done = String(!!sc.finished);
    $h('.live').textContent = sc.finished ? 'FINISHED' : sc.outOfTime ? 'ENDED' : 'LIVE';
  }

  const es = new EventSource(`/live/${encodeURIComponent(id)}/stream`);
  es.onmessage = (ev) => { try { const { meta, snap } = JSON.parse(ev.data); apply(meta, snap); } catch (err) { console.error('live update failed', err); } };
  es.onerror = () => { $h('.live').textContent = 'OFFLINE'; };
})();
