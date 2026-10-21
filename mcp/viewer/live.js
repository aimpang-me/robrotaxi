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

  function sync(W, d) {
    const reqMap = new Map();
    W.reqs = d.reqs.map((r) => { const o = { ...r, car: null }; reqMap.set(o.id, o); return o; });
    for (const sc of d.cars) {
      const c = W.cars.find((x) => x.id === sc.id); if (!c) continue;
      if (c.routeVer !== sc.routeVer) c.drawT = performance.now();
      Object.assign(c, { path: sc.path, seg: sc.seg, prog: sc.prog, x: sc.x, y: sc.y, state: sc.state, battery: sc.battery, chargeTo: sc.chargeTo, plugged: sc.plugged,
        queueT: sc.queueT, holdUntil: sc.holdUntil, strandUntil: sc.strandUntil, routeVer: sc.routeVer });
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
    sync(S, snap);
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
