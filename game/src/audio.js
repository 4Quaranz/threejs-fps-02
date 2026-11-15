// FROSTLINE — synthesized sound, no audio files.
// Every effect is built from oscillators and filtered noise at call time,
// so the game ships zero audio assets and makes zero network requests.
// The context is created lazily on the first user gesture; in headless
// runs without audio it degrades to silence instead of throwing.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  // Distance-attenuated gain: 1 at point blank, ~0.15 at 45 m.
  gainFor(dist) {
    return Math.max(0.12, 1 - (dist || 0) / 55);
  }

  noiseBurst({ dur, freq, q, gain, type = 'bandpass' }) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  tone({ freq, endFreq, dur, gain, type = 'sine' }) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  shot(weaponId, dist = 0) {
    const g = this.gainFor(dist) * 0.55;
    if (weaponId === 'marksman') {
      this.noiseBurst({ dur: 0.22, freq: 900, q: 0.7, gain: g });
      this.tone({ freq: 140, endFreq: 55, dur: 0.18, gain: g * 0.8, type: 'triangle' });
    } else if (weaponId === 'smg') {
      this.noiseBurst({ dur: 0.09, freq: 2400, q: 1.2, gain: g * 0.8 });
    } else if (weaponId === 'pistol') {
      this.noiseBurst({ dur: 0.11, freq: 1800, q: 1.0, gain: g });
    } else {
      this.noiseBurst({ dur: 0.13, freq: 1500, q: 0.9, gain: g });
      this.tone({ freq: 110, endFreq: 60, dur: 0.1, gain: g * 0.5, type: 'triangle' });
    }
  }

  reload() {
    this.tone({ freq: 900, dur: 0.05, gain: 0.2, type: 'square' });
    window.setTimeout(() => this.tone({ freq: 1200, dur: 0.05, gain: 0.2, type: 'square' }), 320);
  }

  hit(headshot) {
    this.tone({ freq: headshot ? 2200 : 1500, dur: 0.06, gain: 0.3, type: 'square' });
  }

  kill() {
    this.tone({ freq: 700, endFreq: 1400, dur: 0.12, gain: 0.25, type: 'sine' });
  }

  explosion() {
    this.noiseBurst({ dur: 0.9, freq: 320, q: 0.5, gain: 0.9, type: 'lowpass' });
    this.tone({ freq: 90, endFreq: 28, dur: 0.8, gain: 0.8, type: 'sine' });
  }

  beep() {
    this.tone({ freq: 1250, dur: 0.09, gain: 0.25, type: 'square' });
  }

  click() {
    this.tone({ freq: 1800, dur: 0.04, gain: 0.2, type: 'square' });
  }

  step() {
    this.noiseBurst({ dur: 0.05, freq: 500, q: 1, gain: 0.08, type: 'lowpass' });
  }

  roundWin() {
    [523, 659, 784].forEach((f, i) => {
      window.setTimeout(() => this.tone({ freq: f, dur: 0.18, gain: 0.25, type: 'triangle' }), i * 130);
    });
  }

  roundLose() {
    [392, 330, 262].forEach((f, i) => {
      window.setTimeout(() => this.tone({ freq: f, dur: 0.2, gain: 0.22, type: 'triangle' }), i * 140);
    });
  }
}
