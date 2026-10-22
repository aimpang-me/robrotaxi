(() => {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const hash = (text) => { let n = 2166136261; for (const c of String(text)) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; };

  class CityMix {
    constructor() { this.previous = null; this.selected = new Set(); }
    read(frame) {
      const zoom = clamp(Math.log(6000 / Math.max(120, frame.viewDistance)) / Math.log(24), 0, 1);
      const previous = this.previous, elapsed = previous ? frame.simTime - previous.simTime : 0;
      const advancing = !frame.paused && previous?.revision === frame.revision && elapsed > 0 && elapsed < 30;
      const poses = new Map(frame.vehicles.map(v => [v.id, v]));
      this.previous = { simTime: frame.simTime, revision: frame.revision, poses };
      const voices = [];
      if (advancing) for (const v of frame.vehicles) {
        const before = previous.poses.get(v.id); if (!before || v.roadActive === false) continue;
        const speed = Math.hypot(v.x - before.x, v.y - before.y) / elapsed;
        if (speed < 0.1 || speed > 36) continue;
        const dx = v.x - frame.focus.x, dy = v.y - frame.focus.y, distance = Math.hypot(dx, dy);
        const gain = (0.004 + 0.24 * zoom * zoom) / (1 + (distance / 150) ** 2) * clamp(speed / 3, 0, 1);
        if (gain < 0.001) continue;
        voices.push({ id: v.id, kind: v.kind, gain,
          pan: clamp((dx * frame.right.x + dy * frame.right.y) / Math.max(80, frame.viewDistance * 0.3), -0.9, 0.9),
          rate: clamp(0.8 + speed / (v.kind === 'car' ? 40 : 60), 0.8, 1.3),
          priority: gain * (this.selected.has(v.id) ? 1.15 : 1) });
      }
      voices.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
      const nearest = voices.slice(0, 8), normalization = Math.max(1, Math.sqrt(nearest.length / 2));
      for (const v of nearest) v.gain /= normalization;
      this.selected = new Set(nearest.map(v => v.id));
      return { zoom, paused: frame.paused, city: frame.paused ? 0 : 0.035 + zoom * 0.17, people: frame.paused ? 0 : zoom * zoom * 0.12, voices: nearest };
    }
    reset() { this.previous = null; this.selected.clear(); }
  }

  class CitySound {
    constructor(context, buffers) {
      this.context = context; this.buffers = buffers; this.mix = new CityMix();
      this.master = context.createGain(); this.master.gain.value = 0;
      const compressor = context.createDynamicsCompressor(); compressor.threshold.value = -18; compressor.ratio.value = 3;
      this.master.connect(compressor); compressor.connect(context.destination);
      this.beds = new Map(); this.slots = []; this.detail = null; this.nextDetail = 0; this.detailIndex = 0;
    }
    ramp(param, value, seconds = 0.15) {
      const at = this.context.currentTime;
      param.cancelScheduledValues(at); param.setTargetAtTime(value, at, seconds / 3);
    }
    loop(key, destination, phase = 0, at = this.context.currentTime) {
      const buffer = this.buffers.get(key); if (!buffer) return null;
      const source = this.context.createBufferSource(); source.buffer = buffer; source.loop = true;
      source.connect(destination); source.onended = () => source.disconnect();
      source.start(at, phase % buffer.duration); return source;
    }
    bed(key, value) {
      let bed = this.beds.get(key);
      if (!bed && this.buffers.has(key)) {
        const gain = this.context.createGain(); gain.gain.value = 0; gain.connect(this.master);
        bed = { gain, source: this.loop(key, gain) }; this.beds.set(key, bed);
      }
      if (bed) this.ramp(bed.gain.gain, value, 0.4);
    }
    update(frame, now) {
      const mix = this.mix.read(frame);
      this.bed('city', mix.city); this.bed('people', mix.people);
      const selected = new Set(mix.voices.map(v => v.id));
      for (const slot of this.slots) if (!selected.has(slot.id)) { slot.id = null; this.ramp(slot.gain.gain, 0); }
      for (const voice of mix.voices) {
        let slot = this.slots.find(s => s.id === voice.id) || this.slots.find(s => s.id == null);
        if (!slot) {
          const gain = this.context.createGain(), pan = this.context.createStereoPanner(); gain.gain.value = 0;
          gain.connect(pan); pan.connect(this.master); slot = { gain, pan, id: null, kind: null, source: null }; this.slots.push(slot);
        }
        slot.id = voice.id;
        if (slot.kind !== voice.kind) {
          const at = this.context.currentTime, start = slot.source ? at + 0.06 : at;
          if (slot.source) {
            slot.gain.gain.cancelScheduledValues(at); slot.gain.gain.setValueAtTime(slot.gain.gain.value, at);
            slot.gain.gain.linearRampToValueAtTime(0, start); slot.source.stop(start);
          }
          slot.source = this.loop(voice.kind, slot.gain, hash(voice.id) / 1000, start); slot.kind = voice.kind;
          slot.gain.gain.setTargetAtTime(voice.gain, start, 0.05);
        } else this.ramp(slot.gain.gain, voice.gain);
        this.ramp(slot.pan.pan, voice.pan);
        if (slot.source) this.ramp(slot.source.playbackRate, voice.rate, 0.3);
      }
      if (mix.paused) {
        if (this.detail) { this.detail.stop(); this.detail = null; }
        this.nextDetail = now + 15000;
      } else if (!this.nextDetail) this.nextDetail = now + 15000;
      else if (now >= this.nextDetail) {
        this.nextDetail = now + 18000 + hash(++this.detailIndex) % 18000;
        const keys = ['birds', 'tram', 'horn'], key = keys[this.detailIndex % keys.length], buffer = this.buffers.get(key);
        if (buffer && mix.zoom > 0.1 && !this.detail) {
          const source = this.context.createBufferSource(), gain = this.context.createGain(), pan = this.context.createStereoPanner();
          source.buffer = buffer; gain.gain.value = 0.035 * mix.zoom;
          pan.pan.value = (hash(this.detailIndex + 'pan') % 140 - 70) / 100;
          source.connect(gain); gain.connect(pan); pan.connect(this.master); this.detail = source;
          source.onended = () => { source.disconnect(); gain.disconnect(); pan.disconnect(); if (this.detail === source) this.detail = null; };
          source.start();
        }
      }
    }
    silence() {
      this.master.gain.cancelScheduledValues(this.context.currentTime); this.master.gain.value = 0;
      for (const slot of this.slots) { slot.source?.stop(); slot.gain.disconnect(); slot.pan.disconnect(); }
      for (const bed of this.beds.values()) { bed.source.stop(); bed.gain.disconnect(); }
      if (this.detail) { this.detail.stop(); this.detail = null; }
      this.slots.length = 0; this.beds.clear(); this.nextDetail = 0; this.mix.reset();
    }
  }

  if (typeof module !== 'undefined') module.exports = { CityMix, CitySound };
  if (typeof window === 'undefined' || !window.__robroAudioHooks) return;
  const H = window.__robroAudioHooks, scriptURL = document.currentScript.src;
  const style = document.createElement('style');
  style.textContent = `.city-audio{position:absolute;right:12px;bottom:12px;z-index:8;display:flex;align-items:center;gap:9px;padding:5px 7px;border:1px solid var(--line);border-radius:4px;background:var(--asphalt-2);color:var(--paint);font:600 12px var(--f-ui)}.city-audio button{min-height:32px;padding:0 8px;border:1px solid var(--line);border-radius:4px;background:var(--road);color:var(--paint);font:inherit;cursor:pointer}.city-audio button[aria-pressed=true]{background:var(--yellow);border-color:var(--yellow);color:var(--road)}.city-audio input{width:76px;accent-color:var(--yellow)}.city-audio output{font-family:var(--f-num);min-width:3ch}.city-audio .status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}@media(pointer:coarse),(max-width:560px){.city-audio{right:8px;bottom:30px}.city-audio button{min-height:44px}.city-audio input{width:64px;min-height:44px}}`;
  document.head.append(style);
  const controls = document.createElement('div'); controls.className = 'city-audio';
  controls.innerHTML = '<button type="button" aria-label="Enable city sound" aria-pressed="false">Sound off</button><input type="range" min="0" max="100" step="1" aria-label="City sound volume"><output></output><a href="https://elevenlabs.io/" target="_blank" rel="noopener" title="City sounds generated with ElevenLabs" style="color:var(--paint-2)">11.ai</a><span class="status" role="status" aria-live="polite"></span>';
  document.querySelector('.mapwrap').append(controls);
  const button = controls.querySelector('button'), slider = controls.querySelector('input'), output = controls.querySelector('output'), status = controls.querySelector('.status');
  let volume = 0.45, state = 'off', epoch = 0, context = null, sound = null, loading = null, lastUpdate = 0;
  try { const saved = JSON.parse(localStorage.getItem('robro-city-audio')); if (saved && Number.isFinite(saved.volume)) volume = clamp(saved.volume, 0, 1); } catch {}
  const persist = () => { try { localStorage.setItem('robro-city-audio', JSON.stringify({ volume })); } catch {} };
  const show = (next, message = '') => {
    state = next; button.textContent = next === 'loading' ? 'Loading sound…' : next === 'on' ? 'Sound on' : 'Sound off';
    button.setAttribute('aria-label', next === 'on' || next === 'loading' ? 'Mute city sound' : 'Enable city sound');
    button.setAttribute('aria-pressed', String(next === 'on')); status.textContent = message; button.title = message || 'City ambience follows the camera. Nearby moving cars get louder as you zoom in.';
  };
  slider.value = String(Math.round(volume * 100)); output.textContent = slider.value + '%';
  slider.addEventListener('input', () => { volume = +slider.value / 100; output.textContent = slider.value + '%'; persist(); if (state === 'on' && !document.hidden) sound.ramp(sound.master.gain, volume); });
  async function load() {
    const response = await fetch(new URL('audio/manifest.json', scriptURL)); if (!response.ok) throw new Error('City sounds are unavailable.');
    const manifest = await response.json(), buffers = new Map();
    await Promise.all(Object.entries(manifest.clips).map(async ([key, clip]) => {
      try {
        const r = await fetch(new URL('audio/' + clip.file, scriptURL)); if (!r.ok) return;
        buffers.set(key, await context.decodeAudioData(await r.arrayBuffer()));
      } catch {}
    }));
    if (!buffers.size) throw new Error('City sounds are unavailable.');
    return { sound: new CitySound(context, buffers), missing: Object.keys(manifest.clips).length - buffers.size };
  }
  button.addEventListener('click', async () => {
    const turn = ++epoch;
    if (state === 'on' || state === 'loading') {
      show('off'); sound?.silence(); if (context) await context.suspend(); return;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('City sound is unavailable in this browser.');
      context ||= new AudioContext(); show('loading'); await context.resume();
      loading ||= load(); const loaded = await loading;
      if (turn !== epoch) return;
      sound = loaded.sound; sound.mix.reset();
      if (document.hidden) await context.suspend(); else { await context.resume(); if (turn !== epoch) return; sound.ramp(sound.master.gain, volume, 0.3); }
      if (turn !== epoch) return;
      show('on', loaded.missing ? 'Sound on. Some city sounds are unavailable.' : 'City sound on. Zoom in to hear the street.');
    } catch (err) {
      if (turn !== epoch) return;
      loading = null; sound?.silence(); if (context) await context.suspend(); show('off', err.message + ' Click to try again.');
    }
  });
  document.addEventListener('visibilitychange', async () => {
    if (!context || context.state === 'closed') return;
    if (document.hidden) { sound?.silence(); await context.suspend(); }
    else if (state === 'on') {
      try { await context.resume(); if (state !== 'on' || document.hidden) return; sound.mix.reset(); sound.ramp(sound.master.gain, volume, 0.3); }
      catch { show('off', 'Click to resume city sound.'); }
    }
  });
  window.addEventListener('pagehide', (event) => {
    ++epoch; sound?.silence();
    if (state === 'loading') show('off');
    if (context && context.state !== 'closed') void (event.persisted ? context.suspend() : context.close());
  });
  window.addEventListener('pageshow', async (event) => {
    if (!event.persisted || state !== 'on' || document.hidden) return;
    try { await context.resume(); if (state === 'on' && !document.hidden) sound.ramp(sound.master.gain, volume, 0.3); }
    catch { show('off', 'Click to resume city sound.'); }
  });
  function animate(now) {
    if (state === 'on' && !document.hidden && now - lastUpdate >= 100) {
      lastUpdate = now; const frame = H.readFrame(); if (frame) sound.update(frame, now);
    }
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
})();
