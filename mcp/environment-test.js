const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index-3d.html'), 'utf8');
const source = html.slice(html.indexOf('const ENV_KEYS ='), html.indexOf('function facadeTexture('));
assert(source.startsWith('const ENV_KEYS =') && source.includes('function sampleEnvironment('));
const fn = html.match(/function applyEnvironment\([\s\S]*?\n\}/)[0];
const context = vm.createContext({ Number, Math });
vm.runInContext(source + '\n' + fn + '\nthis.sample = sampleEnvironment; this.apply = applyEnvironment;', context);
const sample = context.sample;
const at = (h) => sample(h * 3600);
const morning = at(8), noon = at(12), dusk = at(19), night = at(21 + 41 / 60);
assert(morning.sunDirection[1] > 0 && morning.sunIntensity > dusk.sunIntensity);
assert(noon.sunIntensity > morning.sunIntensity && noon.night === 0);
assert(dusk.skyTop !== noon.skyTop && dusk.night > 0);
assert(night.sunDirection[1] < 0 && night.night > 0.9 && !night.shadow);
assert.equal(JSON.stringify(at(0)), JSON.stringify(at(24)), 'clock wraps at 24 hours');
assert.equal(JSON.stringify(at(2)), JSON.stringify(at(26)), 'clock repeats after one day');
const forward = [at(8), at(12), at(19)].map(JSON.stringify);
assert.deepEqual([at(19), at(12), at(8)].map(JSON.stringify), forward.slice().reverse(), 'reverse clock sampling is stable');
assert.equal(JSON.stringify(at(12)), JSON.stringify(at(12)), 'paused clock sampling is stable');
assert.equal(JSON.stringify(sample(NaN)), JSON.stringify(at(0)), 'invalid clock uses midnight');
assert(Math.hypot(...at(23.999).cloudPhase.map((v, i) => v - at(0.001).cloudPhase[i])) < 0.001, 'cloud drift stays continuous at midnight');

const color = () => ({ value: null, copy(v) { this.value = v.value; return this; }, lerp(v, amount) { this.value = `${this.value}|${v.value}|${amount}`; return this; } });
const uniform = () => ({ value: color() });
const water = { uniforms: Object.fromEntries(['deep', 'shallow', 'sky', 'sun', 'sunDir', 'sunlight'].map((k) => [k, uniform()])) };
water.uniforms.sunDir.value.set = function (...v) { this.value = v; };
const sky = { uniforms: Object.fromEntries(['top', 'horizon', 'below', 'sun', 'sunDir', 'sunlight', 'cloudCover', 'cloudPhase'].map((k) => [k, uniform()])) };
sky.uniforms.sunDir.value.set = function (...v) { this.value = v; };
sky.uniforms.cloudPhase.value.set = function (...v) { this.value = v; };
const ART = { enabled: true, sun: { position: { set(...v) { this.value = v; } }, color: color() }, hemi: { color: color(), groundColor: color() }, sky,
  quality: 'high', waterMats: [water], facades: [{ emissiveIntensity: 0 }], lampMats: [], carLights: [{ visible: false }], streetLights: { visible: false, material: {} }, streetPools: { visible: false, material: {} } };
const MAT = { taxiFront: {}, taxiRear: {}, taxiPool: {} };
const scene = { fog: { color: color() } }, renderer = { setClearColor(v) { this.clear = v.value; } };
Object.assign(context, { ART, MAT, scene, renderer, SPAN3: 1000, reduceMotion: false,
  setLin: (target, value) => { target.value = value; return target; }, NIGHT_SKY: { value: '#a8b9d1' }, NIGHT_GROUND: { value: '#647891' } });
context.apply(night);
assert.equal(ART.night, night.night);
assert.equal(ART.sun.castShadow, false);
assert.equal(ART.hemi.intensity, night.ambient);
assert.equal(JSON.stringify(sky.uniforms.cloudPhase.value.value), JSON.stringify(night.cloudPhase));
assert.equal(water.uniforms.deep.value.value, night.waterDeep);
assert(ART.facades[0].emissiveIntensity > 1 && ART.carLights[0].visible && ART.streetPools.visible);
context.apply(noon);
assert.equal(ART.sun.castShadow, true);
assert(!ART.carLights[0].visible && !ART.streetPools.visible && ART.facades[0].emissiveIntensity === 0);
ART.enabled = false; context.apply(night);
assert.equal(ART.night, 0, 'off leaves the fixed daytime frame');

process.env.ROBRO_NO_LOG = '1';
const { Game } = require('./game');
const options = { player: 'Environment check', model: 'fixture', seed: 1101, mode: 'scripted', shadow: false };
const on = new Game(options), off = new Game(options);
for (let i = 0; i < 60 && !on.over(); i++) {
  on.advance(1800, false); off.advance(1800, false);
  ART.enabled = true; context.apply(sample(on.live().t));
  assert.equal(JSON.stringify(on.live()), JSON.stringify(off.live()), `environment changed state in block ${i}`);
  assert.equal(JSON.stringify(on.score()), JSON.stringify(off.score()), `environment changed score in block ${i}`);
}
assert(on.over() && off.over(), 'both seed 1101 runs finish');
assert.equal(JSON.stringify(vm.runInContext('[rD(), rH(), rC(), rnd()]', on.ctx)),
  JSON.stringify(vm.runInContext('[rD(), rH(), rC(), rnd()]', off.ctx)), 'future simulation random draws remain equal');
console.log('Environment clock, application, off flag, and full seed 1101 isolation checks passed.');
console.log('Equal final score ' + JSON.stringify(on.score()));
