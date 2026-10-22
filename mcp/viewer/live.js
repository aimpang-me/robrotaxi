class Playback {
  constructor({ maxPackets = 240, maxBytes = 48 * 1024 * 1024 } = {}) {
    this.maxPackets = maxPackets; this.maxBytes = maxBytes;
    this.future = []; this.events = []; this.base = null;
    this.time = null; this.sourceTime = null; this.lastAt = null;
    this.bytes = 0; this.seenEvent = -1; this.resync = false;
  }
  push(packet, bytes = 0) {
    const { meta, snap } = packet;
    if (this.sourceTime != null && snap.t < this.sourceTime) return;
    const first = snap.evTo - snap.events.length;
    for (let i = 0; i < snap.events.length; i++) if (first + i > this.seenEvent) this.events.push(snap.events[i]);
    this.seenEvent = Math.max(this.seenEvent, snap.evTo - 1);
    const next = { meta, snap: { ...snap, events: [] }, bytes };
    const last = this.future.at(-1);
    if (last?.snap.t === snap.t) this.bytes -= this.future.pop().bytes;
    this.future.push(next); this.bytes += bytes;
    this.sourceTime = snap.t;
    if (this.time == null) this.time = snap.t;
    if (this.future.length > this.maxPackets || this.bytes > this.maxBytes || this.events.length > 4000) {
      this.future = [next]; this.bytes = bytes; this.resync = true;
      this.events = this.events.slice(-4000);
    }
  }
  step(now, { paused = false, speed = 1, hidden = false } = {}) {
    const dt = this.lastAt == null ? 0 : Math.max(0, Math.min(0.1, (now - this.lastAt) / 1000));
    this.lastAt = now;
    if (this.time == null) return { due: [], events: [], base: null, next: null, time: null, buffered: 0, resynced: false };
    let resynced = false;
    if (!paused) {
      if (hidden || this.resync) { this.time = this.sourceTime; resynced = this.resync; this.resync = false; }
      else {
        const rate = Math.max(1, Math.min(60, (this.sourceTime - this.time) / 12)) * speed;
        this.time = Math.min(this.sourceTime, this.time + dt * rate);
      }
    }
    const due = [], events = [];
    if (!paused || !this.base) {
      while (this.future.length && this.future[0].snap.t <= this.time) {
        this.base = this.future.shift(); this.bytes -= this.base.bytes; due.push(this.base);
      }
      while (this.events.length && this.events[0].t <= this.time) events.push(this.events.shift());
    }
    return { due, events, base: this.base, next: this.future[0] || null, time: this.time, buffered: this.sourceTime - this.time, resynced };
  }
}

if (typeof module !== 'undefined') module.exports = Playback;
if (typeof window !== 'undefined') (() => {
  const id = new URLSearchParams(location.search).get('game');
  const H = window.__robroLiveHooks;
  const is3d = location.pathname.endsWith('/3d');
  // 3D needs three.js from the CDN; if it or the page failed to start, show the same game in 2D
  if (id && is3d && (typeof THREE === 'undefined' || !H)) { location.replace('/view/2d' + location.search); return; }
  if (!id || !H) return;
  window.__robroLive = true;
  const playback = new Playback();
  const playbackStatus = window.__robroPlayback = { paused: false, revision: 0 };

  const css = document.createElement('style');
  css.textContent = `
#robroHud{display:grid;gap:7px;flex:none;margin:12px;padding:10px;border:1px solid var(--line);border-radius:4px;background:var(--road);color:var(--paint);font:500 12px/1.4 var(--f-ui);overflow-wrap:anywhere}
#robroHud .who{display:grid;gap:2px}#robroHud b{font-weight:800;font-size:15px}
#robroHud .mono{font-family:var(--f-num);font-variant-numeric:tabular-nums}
#robroHud .live{color:var(--road);background:var(--yellow);border-radius:2px;padding:1px 6px;font-weight:800;letter-spacing:.06em;font-size:11px}
#robroHud .bar{width:100%;height:6px;border-radius:1px;background:var(--line);overflow:hidden}
#robroHud .bar i{display:block;height:100%;background:var(--yellow);width:0}
#robroHud[data-done=true] .live{background:var(--green)}
#robroHud .muted{color:var(--paint-2)}
#robroHud .sw{display:inline-flex;align-items:center;min-height:32px;margin-left:auto;color:var(--paint);font-size:12px;font-weight:700;text-decoration:none;border:1px solid var(--line);border-radius:4px;padding:0 7px}
#robroHud .sw:hover{border-color:var(--yellow)}
#robroHud .top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
#robroHud .think{color:var(--yellow)}#robroHud .think:empty{display:none}
#robroHud .ctl{display:flex;gap:3px}
#robroHud .ctl button{height:32px;font:700 12px/1 var(--f-ui);color:var(--paint);background:var(--asphalt-2);border:1px solid var(--line);border-radius:4px;cursor:pointer;flex:1;min-width:0;padding:0}
#robroHud .ctl button:hover{border-color:var(--yellow)}
#robroHud .ctl button[aria-pressed=true]{background:var(--paint);color:var(--road);border-color:var(--paint)}
#robroHud .lock{color:var(--muted)}
#robroWhy[hidden]{display:none}
#robroWhy{display:flex;flex-direction:column;flex:0 1 34%;min-height:0;margin:0 14px 12px;border:1px solid var(--line);border-radius:4px;background:var(--road);color:var(--paint);font:500 13px/1.4 var(--f-ui);overflow:hidden;overflow-wrap:anywhere}
#robroWhy header{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px dashed var(--line);flex:none}
#robroWhy header b{font-size:12px;font-weight:800;flex:1;min-width:0;color:var(--yellow)}
#robroWhy header button{height:32px;font:700 12px/1 var(--f-ui);color:var(--paint);background:var(--asphalt-2);border:1px solid var(--line);border-radius:4px;padding:0 8px;cursor:pointer}
#robroWhy[data-min=true]{flex:none}#robroWhy[data-min=true] .body{display:none}
#robroWhy .body{overflow:auto;min-height:0;padding:0 10px 8px}
#robroWhy .turn{margin:8px 0;padding:8px 10px;background:var(--asphalt-2);border-left:3px solid var(--yellow)}
#robroWhy .turn small{display:block;font-weight:800;letter-spacing:.06em;text-transform:uppercase;font-size:11px;color:var(--yellow);margin-bottom:2px}
#robroWhy ol{list-style:none;margin:0;padding:0}#robroWhy li{padding:8px 0;border-bottom:1px solid var(--line)}#robroWhy li:last-child{border-bottom:0}
#robroWhy .what{display:flex;gap:8px;align-items:baseline}#robroWhy .what b{min-width:0}
#robroWhy time{flex:none;font:600 12px var(--f-num);color:var(--muted)}
#robroWhy .why{margin-top:3px;color:var(--paint-2)}#robroWhy .none{margin-top:3px;color:var(--muted)}#robroWhy .empty{padding:10px 0;color:var(--muted)}
body[data-live=true] .fleet .cars{flex:1}
body[data-live=true] button:disabled{cursor:not-allowed}
body[data-live=true] #pause,body[data-live=true] [aria-label="Simulation speed"],body[data-live=true] .ctrls .switch,body[data-live=true] .tools,
body[data-live=true] .agent .off-only,body[data-live=true] #tune,body[data-live=true] #connect,body[data-live=true] #handshake{display:none}
body[data-live=true] .agent-id{display:grid}
body[data-live=true] .center{grid-template-rows:auto minmax(0,1fr)}
@media(max-width:1100px){#robroWhy{flex:none;max-height:360px}#robroHud{margin:12px 14px}}
@media(min-width:861px) and (max-width:1100px){body[data-live=true] .center{grid-template-rows:auto minmax(420px,64vh)}}
@media(max-width:860px){body[data-live=true] main{grid-template-areas:"center" "fleet" "agent"}body[data-live=true] .center{grid-template-rows:auto auto}}
@media(pointer:coarse),(max-width:560px){#robroHud .ctl{flex-wrap:wrap}#robroHud .ctl button{height:44px;flex:1 0 28%}#robroHud .sw,#robroWhy header button{min-height:44px}}
`;
  document.head.append(css);
  const hud = document.createElement('div'); hud.id = 'robroHud';
  hud.innerHTML = '<span class="top"><span class="live">LIVE</span> <span class="mono time muted"></span><a class="sw"></a></span><span class="who">Connecting to HQ…</span><span class="mono rev"></span><span class="bar"><i></i></span><span class="think"></span><span class="ctl" role="group" aria-label="Playback speed"></span><span class="lock">Speed and pause only change the view, never the score. Other settings are locked so every model plays the same day.</span>';
  document.body.dataset.live = 'true';
  document.querySelector('.fleet .stripe').after(hud);
  const $h = (s) => hud.querySelector(s);
  const sw = $h('.sw'); sw.textContent = is3d ? 'View 2D' : 'View 3D'; sw.href = (is3d ? '/view/2d' : '/view/3d') + location.search;
  const money = (x) => '$' + Math.round(x).toLocaleString('en-US');

  // playback controls: the server only changes how long it waits between sim steps, so results are identical at any speed
  let ctl = { speed: 1, paused: false };
  const ctlEl = $h('.ctl');
  const setCtl = (patch) => fetch(`/live/${encodeURIComponent(id)}/ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('ctl ' + r.status))))
    .then((c) => { ctl = c; drawCtl(); }).catch(() => {});
  function drawCtl() {
    ctlEl.replaceChildren();
    const mk = (label, pressed, fn, title) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-pressed', String(pressed)); b.addEventListener('click', fn); ctlEl.append(b); };
    mk(ctl.paused ? '▶' : '❚❚', ctl.paused, () => setCtl({ paused: !ctl.paused }), 'Pause or resume the view. The model waits; the game clock is unaffected.');
    for (const [v, l] of [[0.25, '¼×'], [0.5, '½×'], [1, '1×'], [2, '2×'], [4, '4×']]) mk(l, ctl.speed === v, () => setCtl({ speed: v }), 'Playback speed');
  }
  drawCtl();
  const LOCK = 'Locked in a live model game: this would change the day the model is playing, so scores would stop being comparable. Playback speed and pause in the Fleet rail are free.';
  const LOCKED_CONTROLS = '#connect, #agentUrl, .tool, #reseed, #seedIn, #clearInc, #rush, #randomInc, #pause, [data-speed], #wEff, #wBat, #wRr';
  function lockViewerControls() {
    document.querySelectorAll(LOCKED_CONTROLS).forEach((el) => { el.disabled = true; el.title = LOCK; el.style.opacity = '.45'; });
  }
  lockViewerControls();

  // reasoning panel: every decision with the model's own reason, plus its per-turn notes
  const why = document.createElement('aside'); why.id = 'robroWhy'; why.setAttribute('aria-label', 'Dispatcher reasoning');
  why.innerHTML = '<header><b>Why: waiting for the model</b><button type="button">Hide</button></header><div class="body"><div class="empty">Decisions and the reasons the model gives will appear here.</div></div>';
  document.querySelector('.agentrail .agent').after(why);
  const whyBody = why.querySelector('.body'), whyBtn = why.querySelector('button');
  whyBtn.setAttribute('aria-expanded', 'true');
  whyBtn.addEventListener('click', () => { const m = why.dataset.min !== 'true'; why.dataset.min = String(m); whyBtn.textContent = m ? 'Show' : 'Hide'; whyBtn.setAttribute('aria-expanded', String(!m)); });
  let external = false; const feed = []; let lastNote = null, lastMsg = performance.now(), finished = false, resyncedUntil = 0;
  const clk = (t) => String(Math.floor(t / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(t / 60) % 60).padStart(2, '0');
  function takeEvents(evs, meta) {
    let changed = false;
    for (const e of evs) {
      if (!e.model) continue;
      if (e.kind === 'note') lastNote = { t: e.t, text: e.head }; else feed.push({ t: e.t, head: e.head, reason: e.body, tag: e.tag });
      changed = true;
    }
    if (feed.length > 60) feed.splice(0, feed.length - 60);
    if (!changed) return;
    why.querySelector('header b').textContent = `Why: ${meta.player} · ${meta.model}`;
    whyBody.replaceChildren();
    if (lastNote) { const d = document.createElement('div'); d.className = 'turn'; const sm = document.createElement('small'); sm.textContent = `Thinking · ${clk(lastNote.t)}`; d.append(sm, lastNote.text); whyBody.append(d); }
    const ol = document.createElement('ol');
    for (const f of feed.slice().reverse()) {
      const li = document.createElement('li'), w = document.createElement('div'); w.className = 'what';
      const tm = document.createElement('time'); tm.textContent = clk(f.t);
      const b = document.createElement('b'); b.textContent = f.head; w.append(tm, b); li.append(w);
      const r = document.createElement('div'); r.className = f.reason ? 'why' : 'none'; r.textContent = f.reason || 'No reason given'; li.append(r);
      ol.append(li);
    }
    whyBody.append(ol);
  }
  setInterval(() => {
    const el = $h('.think'); if (finished) { el.textContent = ''; return; }
    const now = performance.now(), idle = (now - lastMsg) / 1000;
    const buffered = (playback.sourceTime ?? 0) - (playback.time ?? 0);
    el.textContent = ctl.paused ? 'Paused by you' : now < resyncedUntil ? 'Viewer caught up after the playback buffer filled' : buffered > 0.1 ? `Playing accepted moves · ${Math.ceil(buffered)}s buffered` : external && idle > 1.5 ? 'Caught up · dispatcher thinking (ranked clock paused)' : '';
  }, 500);

  const motion = new Map();
  const trafficMotion = new Map();
  const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const cumOf = (path) => { const c = [0]; for (let i = 1; i < path.length; i++) c.push(c[i - 1] + (H.E(path[i - 1], path[i])?.len || 0)); return c; };
  const segAt = (cum, d) => { let i = 0; while (i < cum.length - 2 && cum[i + 1] <= d) i++; return i; };
  function retarget(m, sc, now, duration) {
    const P = sc.path, cumP = cumOf(P), dT = cumP[Math.min(sc.seg, P.length - 1)] + (sc.seg < P.length - 1 ? sc.prog : 0);
    const cur = m.from + (m.to - m.from) * Math.min(1, (now - m.t0) / m.dur);
    let path = P, cum = cumP, from = dT, to = dT;
    if (sameArr(m.path, P)) { if (dT >= cur - 0.5) from = cur; }
    else if (m.path.length) {
      const overlap = m.path.findIndex((_, i) => m.path.length - i <= P.length && m.path.slice(i).every((n, j) => n === P[j]));
      if (overlap >= 0) {
        const offset = m.cum[overlap];
        if (cur >= offset) from = Math.min(cur - offset, dT);
        else { path = m.path.slice(0, overlap).concat(P); cum = cumOf(path); from = cur; to = offset + dT; }
        Object.assign(m, { path, cum, from, to, t0: now, dur: duration });
        return;
      }
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
    Object.assign(m, { path, cum, from, to, t0: now, dur: duration });
  }
  // pose at distance d along m.path: follows each road's real polyline, with corners rounded
  const LANE = 0.45; // right-hand lane offset in map units; the page adds it itself while a car is moving
  const edgeOf = (path, i) => H.E(path[i], path[i + 1]);
  function poseOf(m, d) {
    const { path, cum } = m, N = H.nodes;
    if (path.length < 2) return null;
    const i = segAt(cum, d), e = edgeOf(path, i);
    let p = e ? H.edgeAt(e, path[i], Math.max(0, d - cum[i])) : { x: N[path[i]].x, y: N[path[i]].y, ang: 0 };
    const R = 1.2; // corner radius, units (12 m)
    const corner = (j) => { // corner at path[j], between road j-1 and road j
      if (j <= 0 || j >= path.length - 1) return null;
      const ei = edgeOf(path, j - 1), eo = edgeOf(path, j); if (!ei || !eo) return null;
      const ra = Math.min(R, ei.len / 2), rb = Math.min(R, eo.len / 2), s0 = cum[j] - ra, s1 = cum[j] + rb;
      if (d < s0 || d > s1) return null;
      const A = H.edgeAt(ei, path[j - 1], ei.len - ra), A2 = H.edgeAt(ei, path[j - 1], ei.len), B = H.edgeAt(eo, path[j], rb), B2 = H.edgeAt(eo, path[j], 0), C = N[path[j]];
      let turn = B2.ang - A2.ang; while (turn > 180) turn -= 360; while (turn < -180) turn += 360;
      if (Math.abs(turn) < 8) return null;
      const u = d < cum[j] ? 0.5 * (d - s0) / ra : 0.5 + 0.5 * (d - cum[j]) / rb, v = 1 - u;
      return { x: v * v * A.x + 2 * v * u * C.x + u * u * B.x, y: v * v * A.y + 2 * v * u * C.y + u * u * B.y,
        ang: Math.atan2(2 * v * (C.y - A.y) + 2 * u * (B.y - C.y), 2 * v * (C.x - A.x) + 2 * u * (B.x - C.x)) * 180 / Math.PI };
    };
    return corner(i) || corner(i + 1) || p;
  }
  function place(c, m, now, dt) {
    const d = m.from + (m.to - m.from) * Math.max(0, Math.min(1, (now - m.t0) / m.dur));
    const p = poseOf(m, d);
    const moving = !!p && d < m.cum[m.cum.length - 1] - 0.01;
    if (p) m.ang = p.ang;
    const i = m.path.length > 1 ? segAt(m.cum, d) : 0, e = m.path.length > 1 ? edgeOf(m.path, i) : null;
    // ease onto and off the lane when a car pulls away from or stops at an intersection. The page adds the full lane
    // offset itself while c.seg is mid-road, so livePos carries only the difference.
    m.off += ((moving ? 1 : 0) - m.off) * Math.min(1, dt * 6);
    const lane = e && e.oneway ? 0 : LANE, pageLane = moving ? lane : 0, a = (m.ang || 0) * Math.PI / 180, k = lane * m.off - pageLane;
    let x, y;
    if (p) ({ x, y } = p); else { const n = H.nodes[m.path[0]]; x = n.x; y = n.y; }
    c.livePos = { x: x - Math.sin(a) * k, y: y + Math.cos(a) * k, ang: m.ang ?? c.ang };
    c.path = m.path; c.seg = moving ? i : m.path.length - 1; c.prog = moving ? d - m.cum[i] : 0;
  }
  function prepareMotion(base, next) {
    const betweenSnapshots = (sc, previous, target, preservePlan) => {
      const path = sc.path.slice(), cum = cumOf(path), d = cum[Math.min(sc.seg, path.length - 1)] + (sc.seg < path.length - 1 ? sc.prog : 0);
      const m = { path, cum, from: d, to: d, t0: base.snap.t * 1000, dur: 1, ang: previous?.ang ?? sc.ang, off: previous?.off ?? 0 };
      if (!target || next.snap.t <= base.snap.t || sc.roadActive === false) return m;
      const candidate = { ...m };
      retarget(candidate, target, m.t0, (next.snap.t - base.snap.t) * 1000);
      if (preservePlan && !sameArr(candidate.path, path)) return m;
      const a = poseOf(m, d) || H.nodes[path[0]], b = poseOf(candidate, candidate.from) || H.nodes[candidate.path[0]];
      return Math.hypot(a.x - b.x, a.y - b.y) < 0.1 ? candidate : m;
    };
    for (const [key, map] of [['cars', motion], ['traffic', trafficMotion]]) {
      const source = key === 'cars' ? base.snap.cars : base.snap.traffic?.vehicles || [];
      const target = new Map((key === 'cars' ? next?.snap.cars || [] : next?.snap.traffic?.vehicles || []).map(sc => [sc.id, sc]));
      const ids = new Set(source.map(sc => sc.id));
      for (const sc of source) map.set(sc.id, betweenSnapshots(sc, map.get(sc.id), target.get(sc.id), key === 'cars'));
      for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
    }
  }
  function drawTime(snap, time) {
    const sc = snap.score, elapsed = sc.elapsedMin + (time - snap.t) / 60;
    const label = sc.finished ? `finished in ${(sc.finishMin / 60).toFixed(2)} h` : sc.outOfTime ? 'out of time' : `${Math.floor(elapsed / 60)}h ${String(Math.floor(elapsed % 60)).padStart(2, '0')}m`;
    if ($h('.time').textContent !== label) $h('.time').textContent = label;
    const clock = document.getElementById('clock'); if (clock && clock.textContent !== clk(time)) clock.textContent = clk(time);
  }
  let lastFrame = performance.now(), preparedBase = null, preparedNext = null;
  function animate(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
    const frame = playback.step(now, { ...ctl, hidden: document.hidden });
    playbackStatus.paused = ctl.paused;
    if (frame.resynced) playbackStatus.revision++;
    for (const packet of frame.due) apply(packet.meta, packet.snap);
    if (frame.base) {
      const S = H.main();
      if (frame.base !== preparedBase || frame.next !== preparedNext) {
        prepareMotion(frame.base, frame.next); preparedBase = frame.base; preparedNext = frame.next;
      }
      S.t = frame.time;
      for (const c of S.cars) { const m = motion.get(c.id); if (m) place(c, m, frame.time * 1000, ctl.paused ? 0 : dt); }
      for (const v of S.traffic?.vehicles || []) { const m = trafficMotion.get(v.id); if (m) place(v, m, frame.time * 1000, ctl.paused ? 0 : dt); }
      for (const e of frame.events) { if (e.kind === 'fare') continue; S.t = e.t; H.log(e); }
      S.t = frame.time;
      takeEvents(frame.events, frame.base.meta);
      drawTime(frame.base.snap, frame.time);
      if (frame.resynced) resyncedUntil = now + 5000;
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  function sync(W, d) {
    const reqMap = new Map(), now = performance.now();
    W.reqs = d.reqs.map((r) => { const o = { ...r, car: null }; reqMap.set(o.id, o); return o; });
    for (const sc of d.cars) {
      const c = W.cars.find((x) => x.id === sc.id); if (!c) continue;
      if (c.routeVer !== sc.routeVer) c.drawT = now;
      Object.assign(c, { state: sc.state, roadActive: sc.roadActive, battery: sc.battery, chargeTo: sc.chargeTo, plugged: sc.plugged,
        queueT: sc.queueT, holdUntil: sc.holdUntil, strandUntil: sc.strandUntil, routeVer: sc.routeVer });
      c.parkNode = sc.roadActive === false ? sc.path[sc.seg] : null;
      delete c.livePos; Object.assign(c, { path: sc.path, seg: sc.seg, prog: sc.prog, x: sc.x, y: sc.y });
      c.depot = H.DEPOTS.find((x) => x.name === sc.depot) || null;
      c.job = sc.job ? reqMap.get(sc.job) || null : null; if (c.job) c.job.car = c;
      c.next = sc.next ? reqMap.get(sc.next) || null : null; if (c.next) c.next.car = c;
      c.known = new Set(sc.known);
    }
    const previous = new Map((W.traffic?.vehicles || []).map((v) => [v.id, v]));
    W.traffic = { vehicles: (d.traffic?.vehicles || []).map((sc) => {
      const v = previous.get(sc.id) || { ...sc };
      delete v.livePos; Object.assign(v, sc);
      return v;
    }) };
  }
  let announced = false;
  function apply(meta, snap) {
    finished = !!(snap.score.finished || snap.score.outOfTime); external = meta.mode === 'external'; why.hidden = !external;
    if (!announced) document.getElementById('feed').replaceChildren();
    H.setSeed(meta.seed);
    const S = H.main();
    Object.assign(S, { t: snap.t, agent: snap.agent, agentSince: snap.agentSince, connectT: snap.connectT, rph: snap.rph, hazIdx: snap.hazIdx, rush: snap.rush, paused: false });
    sync(S, snap);
    S.periods = snap.periods; S.waitSeries = snap.waitSeries;
    if (snap.shadow) {
      if (!H.shadow()) H.setShadow(H.cloneWorld(S));
      const sh = H.shadow(); sync(sh, snap.shadow); sh.periods = snap.shadow.periods; sh.waitSeries = snap.shadow.waitSeries || [];
    } else H.setShadow(null);
    S.incidents.length = 0;
    for (const i of snap.incidents) S.incidents.push({ ...i, edge: H.edges[i.edge] });
    H.recomputeTraffic();
    H.setAgentUI();
    lockViewerControls();
    // HUD
    const sc = snap.score;
    if (!announced) {
      announced = true; document.title = `${meta.player} · ${meta.model} · RobroTaxi live`;
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
    hud.dataset.done = String(!!sc.finished);
    $h('.live').textContent = sc.finished ? 'FINISHED' : sc.outOfTime ? 'ENDED' : 'LIVE';
  }

  let streamErrors = 0;
  const es = new EventSource(`/live/${encodeURIComponent(id)}/stream`);
  es.onmessage = (ev) => {
    streamErrors = 0;
    try { const packet = JSON.parse(ev.data), c = packet.ctl; lastMsg = performance.now(); if (c && (c.speed !== ctl.speed || c.paused !== ctl.paused)) { ctl = c; drawCtl(); } playback.push(packet, ev.data.length * 2); } catch (err) { console.error('live update failed', err); }
  };
  es.onerror = () => {
    streamErrors++;
    $h('.live').textContent = 'OFFLINE';
    // A 404/503 stream (stale link, game over, or the watcher cap) closes EventSource for good; a
    // transient network error retries. Either way, stop retrying forever and say why.
    const closed = es.readyState === EventSource.CLOSED;
    if (closed || streamErrors > 4) {
      es.close();
      $h('.live').textContent = 'ENDED';
      if ($h('.who')) $h('.who').textContent = 'HQ is full or this game is no longer live — open the watch link again.';
    }
  };
})();
