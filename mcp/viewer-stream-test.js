process.env.ROBRO_NO_LOG = '1';
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const { Game } = require('./game');
const { createViewerStreams, acceptsGzip } = require('./viewer-stream');

const waitFor = async (test, message) => {
  const until = Date.now() + 10000;
  while (!test()) {
    if (Date.now() > until) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

async function main() {
  assert.equal(acceptsGzip('gzip, br'), true);
  assert.equal(acceptsGzip('gzip;q=0, *;q=1'), false);
  assert.equal(acceptsGzip('br, *;q=0.5'), true);
  assert.equal(acceptsGzip('gzip;q=0'), false);

  const g = new Game({ player: 'stream test', model: 'fixture', seed: 2207 });
  const originalLive = g.live.bind(g);
  let clones = 0;
  g.live = (from) => { clones++; return originalLive(from); };
  const watchers = new Map();
  const streams = createViewerStreams(watchers, 300);
  let blockedResponse;
  const server = http.createServer((req, res) => {
    if (req.url !== '/stream') { res.writeHead(404); return res.end(); }
    if (req.headers['x-block-response']) blockedResponse = res;
    streams.subscribe(g, req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const clients = [];
  async function open(headers = {}) {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/stream', headers });
    const res = await new Promise((resolve, reject) => { req.on('response', resolve); req.on('error', reject); });
    const client = { req, res, status: res.statusCode, frames: [], wireBytes: 0, closed: false };
    const decoder = res.headers['content-encoding'] === 'gzip' ? zlib.createGunzip() : res;
    res.on('data', (chunk) => { client.wireBytes += chunk.length; });
    let pending = '';
    decoder.on('data', (chunk) => {
      pending += chunk.toString();
      let end;
      while ((end = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, end); pending = pending.slice(end + 2);
        client.frames.push(frame.startsWith('data: ') ? JSON.parse(frame.slice(6)) : frame);
      }
    });
    if (decoder !== res) res.pipe(decoder);
    res.on('close', () => { client.closed = true; });
    client.close = () => { req.destroy(); res.destroy(); if (decoder !== res) decoder.destroy(); };
    clients.push(client);
    if (res.statusCode !== 200) { // e.g. the 503 watcher-cap response: read it as a plain body, not SSE
      let body = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { body += chunk; });
      await new Promise((resolve) => res.on('end', resolve));
      client.body = body;
      return client;
    }
    await waitFor(() => client.frames.length > 0, 'first snapshot did not arrive');
    return client;
  }

  try {
    const plain = await open({ 'accept-encoding': 'gzip;q=0, *;q=1' });
    assert.equal(plain.res.headers['content-encoding'], undefined);
    assert.equal(plain.res.headers.vary, 'Accept-Encoding');
    assert.equal(plain.frames[0].snap.events[0].tag, 'Online');
    assert.deepEqual(plain.frames[0].snap, originalLive(0), 'first packet keeps every snapshot field');
    assert.deepEqual(plain.frames[0].ctl, g.ctl, 'first packet keeps control fields');
    assert.deepEqual(Object.keys(plain.frames[0].meta).sort(), ['id', 'player', 'model', 'seed', 'ranked', 'mode'].sort());
    assert.equal(watchers.get(g.id).size, 1);
    assert.equal(g.listeners.size, 1);
    const stateBeforeEmit = JSON.stringify(originalLive(0));
    const beforeOne = clones, oneWireBefore = plain.wireBytes;
    g.emit();
    await waitFor(() => plain.frames.length === 2, 'one viewer did not receive broadcast');
    assert.equal(clones - beforeOne, 1, 'one viewer uses one live clone per emit');
    assert.equal(JSON.stringify(originalLive(0)), stateBeforeEmit, 'viewer emit does not change the sim');
    const oneWire = plain.wireBytes - oneWireBefore;
    const oneRaw = Buffer.byteLength(`data: ${JSON.stringify(plain.frames[1])}\n\n`);
    assert.equal(oneWire, oneRaw);
    plain.close();
    await waitFor(() => !watchers.has(g.id), 'last viewer did not remove its hub');
    assert.equal(g.listeners.size, 0);

    const oneGzip = await open({ 'accept-encoding': 'gzip' });
    const gzipBefore = oneGzip.wireBytes;
    g.emit();
    await waitFor(() => oneGzip.frames.length === 2, 'single gzip viewer did not receive broadcast');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const oneGzipWire = oneGzip.wireBytes - gzipBefore;
    const oneGzipRaw = Buffer.byteLength(`data: ${JSON.stringify(oneGzip.frames[1])}\n\n`);
    assert(oneGzipWire < oneGzipRaw);
    oneGzip.close();
    await waitFor(() => !watchers.has(g.id), 'single gzip viewer did not close');

    const gz = await open({ 'accept-encoding': 'gzip' });
    assert.equal(gz.res.headers['content-encoding'], 'gzip');
    assert.equal(gz.frames[0].snap.events[0].tag, 'Online');
    g.note('A causal note reaches current viewers.');
    await waitFor(() => gz.frames.length === 2, 'causal event was not streamed');
    assert(gz.frames[1].snap.events.some((event) => event.kind === 'note'));
    const late = await open({ 'accept-encoding': 'gzip' });
    assert(late.frames[0].snap.events.some((event) => event.kind === 'note'), 'late join gets full history');
    const cursorBeforeControl = gz.frames[1].snap.evTo;
    g.ctl.paused = true; g.emit();
    await waitFor(() => gz.frames.length === 3 && late.frames.length === 2, 'control broadcast missing');
    assert.equal(gz.frames[2].ctl.paused, true);
    assert.equal(gz.frames[2].snap.evTo, cursorBeforeControl);
    assert.deepEqual(gz.frames[2].snap.events, []);
    g.note('A later note reaches both viewers exactly once.');
    await waitFor(() => gz.frames.length === 4 && late.frames.length === 3, 'later causal event missing');
    assert.deepEqual(gz.frames[3].snap.events, late.frames[2].snap.events);
    gz.close(); late.close();
    await waitFor(() => !watchers.has(g.id), 'two-viewer hub did not close');

    const blocked = await open({ 'x-block-response': '1' });
    assert.equal(watchers.get(g.id).size, 1);
    blockedResponse.cork();
    g.emit();
    await Promise.resolve();
    g.emit();
    await Promise.resolve();
    g.emit();
    await waitFor(() => blocked.closed && !watchers.has(g.id), 'blocked socket was not disconnected after its one pending packet filled');
    const reconnect = await open({ 'accept-encoding': 'gzip' });
    assert(reconnect.frames[0].snap.events.some((event) => event.kind === 'note'), 'reconnect starts with full snapshot');
    reconnect.close();
    await waitFor(() => !watchers.has(g.id), 'reconnect cleanup failed');

    const batch = await open({ 'accept-encoding': 'gzip' }), beforeBatch = clones;
    g.note('First action in one turn.');
    g.note('Second action in one turn.');
    g.note('Third action in one turn.');
    await waitFor(() => batch.closed || batch.frames.length === 2, 'same-turn action batch did not arrive');
    assert.equal(batch.closed, false, 'a healthy gzip viewer must survive a normal synchronous action batch');
    assert.equal(clones - beforeBatch, 1, 'same-turn actions share one final snapshot');
    assert.deepEqual(batch.frames[1].snap.events.map(event => event.head), ['First action in one turn.', 'Second action in one turn.', 'Third action in one turn.']);
    g.note('Before an overlapping control update.');
    await Promise.resolve();
    g.ctl.paused = false; g.emit();
    await waitFor(() => batch.closed || batch.frames.length === 4, 'overlapping gzip packets did not arrive');
    assert.equal(batch.closed, false, 'one short compressor overlap is buffered rather than disconnecting a healthy viewer');
    assert.equal(batch.frames[2].snap.events[0].head, 'Before an overlapping control update.');
    assert.equal(batch.frames[3].ctl.paused, false);
    assert.deepEqual(batch.frames[3].snap.events, [], 'buffered control cannot duplicate the preceding event');
    batch.close(); await waitFor(() => !watchers.has(g.id), 'batch viewer cleanup failed');

    const backedUp = await open({ 'accept-encoding': 'gzip' });
    g.emit(); await Promise.resolve(); g.emit(); await Promise.resolve(); g.emit();
    await waitFor(() => backedUp.closed && !watchers.has(g.id), 'compressor backlog remains bounded to one pending packet');

    const crowd = [];
    for (let i = 0; i < 300; i++) crowd.push(await open({ 'accept-encoding': 'gzip' }));
    assert.equal(watchers.get(g.id).size, 300);
    assert.equal(g.listeners.size, 1);
    const full = await open({ 'accept-encoding': 'gzip' });
    // The cap is an explicit 503 with a body a viewer can read; a named SSE "full" event used to be
    // sent on a 200 stream, which EventSource.onmessage never sees (silent reconnect loop).
    assert.equal(full.status, 503);
    assert.equal(full.res.headers['retry-after'], '10');
    assert.equal(full.res.headers['content-type'], 'text/plain; charset=utf-8');
    assert(full.body.includes('viewer slots'), 'over-cap response explains the cap');
    assert.equal(full.frames.length, 0, 'over-cap response is not an SSE packet');
    assert.equal(watchers.get(g.id).size, 300, 'full response does not bypass the cap');
    const beforeCrowd = clones, wiresBefore = crowd.map((client) => client.wireBytes);
    g.emit();
    await waitFor(() => crowd.every((client) => client.frames.length === 2), '300 viewers did not receive broadcast');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(clones - beforeCrowd, 1, '300 viewers share one live clone per emit');
    const crowdWire = crowd.reduce((n, client, i) => n + client.wireBytes - wiresBefore[i], 0);
    const crowdRaw = Buffer.byteLength(`data: ${JSON.stringify(crowd[0].frames[1])}\n\n`) * 300;
    assert(crowdWire < crowdRaw, 'gzip reduces measured wire bytes');
    console.log(JSON.stringify({ oneViewer: { measuredPlainWireBytes: oneWire, measuredGzipWireBytes: oneGzipWire, rawBytes: oneGzipRaw, measuredClonesPerEmit: 1, rawSavingsPercent: +(100 * (1 - oneGzipWire / oneGzipRaw)).toFixed(1) }, threeHundredViewers: { measuredGzipWireBytes: crowdWire, projectedRawWireBytes: crowdRaw, measuredClonesPerEmit: clones - beforeCrowd, rawSavingsPercent: +(100 * (1 - crowdWire / crowdRaw)).toFixed(1) } }));
    for (const client of crowd) client.close();
    await waitFor(() => !watchers.has(g.id), 'crowd cleanup failed');
    assert.equal(g.listeners.size, 0);
  } finally {
    for (const client of clients) client.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
