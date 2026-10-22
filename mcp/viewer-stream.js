const zlib = require('node:zlib');

function acceptsGzip(header) {
  if (!header) return false;
  const encodings = new Map();
  for (const entry of String(header).split(',')) {
    const [name, ...params] = entry.trim().toLowerCase().split(';');
    let quality = 1;
    for (const param of params) {
      const match = /^\s*q\s*=\s*([\d.]+)\s*$/.exec(param);
      if (match) quality = +match[1];
      else if (/^\s*q\s*=/.test(param)) quality = 0;
    }
    if (name) encodings.set(name, quality >= 0 && quality <= 1 ? quality : 0);
  }
  return (encodings.get('gzip') ?? encodings.get('*') ?? 0) > 0;
}

function createViewerStreams(watchers, limit) {
  function subscribe(g, req, res) {
    const headers = {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
      vary: 'Accept-Encoding',
    };
    const compressed = acceptsGzip(req.headers['accept-encoding']);
    if (compressed) headers['content-encoding'] = 'gzip';
    const total = [...watchers.values()].reduce((n, hub) => n + hub.size, 0);
    if (total >= limit) {
      res.writeHead(200, headers);
      if (compressed) {
        const gzip = zlib.createGzip({ level: 1 });
        gzip.pipe(res);
        gzip.end('event: full\ndata: {}\n\n');
      } else res.end('event: full\ndata: {}\n\n');
      return;
    }

    let hub = watchers.get(g.id);
    const meta = { id: g.id, player: g.player, model: g.model, seed: g.seed, ranked: g.ranked, mode: g.mode };
    if (!hub) {
      const clients = new Set();
      const broadcast = () => {
        const snap = g.live(hub.cursor);
        hub.cursor = snap.evTo;
        const packet = `data: ${JSON.stringify({ meta, snap, ctl: g.ctl })}\n\n`;
        for (const client of clients) client.send(packet);
      };
      const heartbeat = setInterval(() => {
        for (const client of clients) client.send(': ka\n\n');
      }, 15000);
      hub = { clients, cursor: 0, get size() { return clients.size; }, broadcast, heartbeat };
      watchers.set(g.id, hub);
      g.listeners.add(broadcast);
    }

    res.writeHead(200, headers);
    const gzip = compressed ? zlib.createGzip({ level: 1 }) : null;
    let closed = false, busy = false, compressorBlocked = false, responseBlocked = false;
    const close = () => {
      if (closed) return;
      closed = true;
      hub.clients.delete(client);
      if (gzip) gzip.destroy();
      if (!res.destroyed) res.destroy();
      if (hub.size === 0) {
        clearInterval(hub.heartbeat);
        g.listeners.delete(hub.broadcast);
        watchers.delete(g.id);
      }
    };
    const client = {
      send(packet) {
        if (closed) return;
        if (busy || compressorBlocked || responseBlocked) return close();
        try {
          if (!gzip) {
            responseBlocked = !res.write(packet);
            return;
          }
          busy = true;
          compressorBlocked = !gzip.write(packet);
          gzip.flush(zlib.constants.Z_SYNC_FLUSH, () => { busy = false; });
        } catch { close(); }
      },
    };
    if (gzip) {
      gzip.on('data', (chunk) => {
        if (closed) return;
        try { if (!res.write(chunk)) responseBlocked = true; } catch { close(); }
      });
      gzip.on('drain', () => { compressorBlocked = false; });
      gzip.on('error', close);
    }
    res.on('drain', () => { responseBlocked = false; });
    res.on('close', close);
    res.on('error', close);
    hub.clients.add(client);
    const full = g.live(0);
    if (hub.size === 1) hub.cursor = full.evTo;
    client.send(`data: ${JSON.stringify({ meta, snap: full, ctl: g.ctl })}\n\n`);
  }
  return { subscribe };
}

module.exports = { createViewerStreams, acceptsGzip };
