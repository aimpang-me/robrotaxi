const assert = require('node:assert/strict');
const { CityMix, CitySound } = require('./viewer/city-audio');
const vehicles = (offset = 0) => Array.from({ length: 30 }, (_, i) => ({ id: 'V' + i, kind: ['ev', 'car', 'bus'][i % 3], x: offset + i * 8, y: 5, roadActive: true }));
const frame = (t, offset = 0, overrides = {}) => ({ simTime: t, revision: '1101:0', paused: false, focus: { x: 0, y: 0 }, right: { x: 1, y: 0 }, viewDistance: 300, vehicles: vehicles(offset), ...overrides });
const mix = new CityMix();
assert.equal(mix.read(frame(0)).voices.length, 0, 'joining cannot invent car speed');
const input = frame(.1, 1), original = JSON.stringify(input), moving = mix.read(input);
assert.equal(moving.voices.length, 8, 'only eight nearby moving vehicle voices can play');
assert.equal(JSON.stringify(input), original, 'audio leaves displayed world and camera state unchanged');
assert(moving.voices.every(v => v.gain > 0 && v.rate >= .8 && v.rate <= 1.3 && Math.abs(v.pan) <= .9));
assert.equal(mix.read(input).voices.length, 0, 'caught-up playback fades movement even when cars retain driving state');
assert.equal(mix.read(frame(.2, 1, { focus: { x: 50, y: 0 }, right: { x: 0, y: 1 } })).voices.length, 0, 'camera motion cannot create engine acceleration');
const pause = mix.read(frame(.3, 2, { paused: true }));
assert.equal(pause.city, 0); assert.equal(pause.people, 0); assert.equal(pause.voices.length, 0);
assert.equal(mix.read(frame(.4, 2000)).voices.length, 0, 'tows and teleports cannot create loud movement');
assert.equal(mix.read(frame(.5, 2001, { revision: '1101:1' })).voices.length, 0, 'playback resynchronization resets movement history');
const parked = vehicles(2002).map(v => ({ ...v, roadActive: false }));
assert.equal(mix.read(frame(.6, 2002, { revision: '1101:1', vehicles: parked })).voices.length, 0, 'curbside taxis stay silent');
const gains = [6000, 3000, 1000, 250].map(viewDistance => new CityMix().read(frame(0, 0, { viewDistance })).city);
assert(gains.every((g, i) => !i || g > gains[i - 1]), 'city ambience grows continuously louder while zooming in');
const stereo = new CityMix(); stereo.read(frame(0));
const left = stereo.read(frame(.1, 1)), right = stereo.read(frame(.2, 2, { right: { x: -1, y: 0 } }));
assert(left.voices[0].pan > 0 && right.voices[0].pan < 0, 'camera orbit reverses stereo position in world space');

class Param {
  constructor() { this.value = 0; }
  cancelScheduledValues() {}
  setTargetAtTime(v) { this.value = v; }
  setValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
}
class AudioNode {
  constructor() { for (const key of ['gain', 'pan', 'playbackRate', 'threshold', 'ratio']) this[key] = new Param(); }
  connect() {}
  disconnect() {}
  start(at = 0) { this.startedAt = at; }
  stop(at = 0) { this.stoppedAt = at; this.stopped = true; }
}
const context = { currentTime: 0, destination: {}, createGain: () => new AudioNode(), createStereoPanner: () => new AudioNode(), createDynamicsCompressor: () => new AudioNode(), createBufferSource: () => new AudioNode() };
const buffers = new Map(['city', 'people', 'ev', 'car', 'bus', 'birds', 'tram', 'horn'].map(key => [key, { duration: 8 }]));
const sound = new CitySound(context, buffers);
sound.update(frame(0), 0); sound.update(frame(.1, 1), 100);
assert.equal(sound.slots.length, 8);
for (let i = 2; i <= 100; i++) {
  context.currentTime = i / 10;
  const state = frame(i / 10, i);
  if (i % 5 === 0) state.vehicles.reverse();
  sound.update(state, i * 100);
  assert(sound.slots.length <= 8, 'identity churn cannot expand the audio voice pool');
}
sound.update(frame(10.1, 101), 20000);
assert(sound.detail, 'a sparse city detail can play after its wall-time deadline');
const detail = sound.detail;
sound.update(frame(10.2, 102, { paused: true }), 20100);
assert(detail.stopped, 'pause also stops a currently playing city detail');
assert(sound.slots.every(slot => slot.gain.gain.value === 0));
sound.silence();
assert.equal(sound.slots.length, 0); assert.equal(sound.beds.size, 0); assert.equal(sound.master.gain.value, 0);
sound.update(frame(400, 1000), 300000);
assert.equal(sound.detail, null, 'resume skips missed city details instead of playing a backlog');
assert.equal(sound.slots.length, 0, 'resume must establish movement history before starting car sounds');

const { Game } = require('./game');
const game = new Game({ player: 'Audio isolation', model: 'fixture', seed: 1101, mode: 'scripted', shadow: false });
const before = JSON.stringify(game.live());
for (let i = 0; i < 300; i++) sound.update(frame(i / 10, i), i * 100);
assert.equal(JSON.stringify(game.live()), before, 'audio activity cannot change riders, traffic, hazards, RNG or score');
async function checkBrowserLifecycle() {
  const vm = require('node:vm'), fs = require('node:fs');
  const element = () => ({ value: '', textContent: '', listeners: {}, setAttribute() {}, addEventListener(type, listener) { this.listeners[type] = listener; } });
  const button = element(), slider = element(), output = element(), status = element(), controls = element();
  controls.querySelector = selector => ({ button, input: slider, output, '.status': status })[selector];
  const instances = [];
  class BrowserAudioContext {
    constructor() { Object.assign(this, context); this.state = 'suspended'; instances.push(this); }
    async resume() { assert.notEqual(this.state, 'closed', 'a closed context cannot resume'); this.state = 'running'; }
    async suspend() { assert.notEqual(this.state, 'closed', 'a closed context cannot suspend'); this.state = 'suspended'; }
    async close() { this.state = 'closed'; }
    async decodeAudioData() { return { duration: 8 }; }
  }
  const window = { listeners: {}, AudioContext: BrowserAudioContext, __robroAudioHooks: { readFrame: () => frame(0) }, addEventListener(type, listener) { this.listeners[type] = listener; } };
  const document = { hidden: false, listeners: {}, currentScript: { src: 'http://localhost/city-audio.js' }, head: { append() {} },
    createElement: tag => tag === 'div' ? controls : element(), querySelector: () => ({ append() {} }),
    addEventListener(type, listener) { this.listeners[type] = listener; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('./viewer/city-audio'), 'utf8'), {
    window, document, URL, requestAnimationFrame() {}, localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => ({ ok: true, json: async () => ({ clips: { city: { file: 'city.mp3' } } }), arrayBuffer: async () => new ArrayBuffer(8) })
  });
  await button.listeners.click(); assert.equal(button.textContent, 'Sound on');
  await window.listeners.pagehide({ persisted: true });
  assert.equal(instances[0].state, 'suspended', 'history navigation preserves the reusable audio context');
  await window.listeners.pageshow({ persisted: true });
  assert.equal(instances[0].state, 'running', 'returning through browser history resumes enabled sound');
  await button.listeners.click(); assert.equal(button.textContent, 'Sound off');
  await button.listeners.click(); assert.equal(button.textContent, 'Sound on', 'mute and enable still work after history restoration');
  assert.equal(instances.length, 1, 'history restoration cannot leak another audio context');
  document.hidden = true; await document.listeners.visibilitychange();
  assert.equal(instances[0].state, 'suspended');
  document.hidden = false; await document.listeners.visibilitychange();
  assert.equal(instances[0].state, 'running');
  await window.listeners.pagehide({ persisted: false });
  assert.equal(instances[0].state, 'closed', 'actual page disposal releases audio resources');
}
checkBrowserLifecycle().then(() => console.log('City audio checks pass for zoom, motion, voice limits, pause, resync, simulation isolation, visibility and browser history.')).catch(error => { console.error(error); process.exitCode = 1; });
