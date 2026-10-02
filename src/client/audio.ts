/** Tiny synthesized sound effects (Web Audio, no files). */
class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private whooshNode: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem('ba.muted') === '1';
    } catch {
      /* storage unavailable */
    }
  }

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem('ba.muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (m) this.stopWhoosh();
  }

  private ready(): AudioContext | null {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private env(ctx: AudioContext, peak: number, attack: number, decay: number, at = ctx.currentTime): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(ctx.destination);
    return g;
  }

  private tone(type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number, delay = 0) {
    const ctx = this.ready();
    if (!ctx) return;
    const at = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + attack + decay);
    o.connect(this.env(ctx, peak, attack, decay, at));
    o.start(at);
    o.stop(at + attack + decay + 0.05);
  }

  private burst(peak: number, decay: number, type: BiquadFilterType, freq: number, q = 1, delay = 0) {
    const ctx = this.ready();
    if (!ctx || !this.noise) return;
    const at = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f);
    f.connect(this.env(ctx, peak, 0.005, decay, at));
    src.start(at, Math.random() * 0.5);
    src.stop(at + decay + 0.1);
  }

  /** Bow string release. */
  release() {
    this.tone('triangle', 190, 70, 0.35, 0.004, 0.22);
    this.burst(0.25, 0.08, 'highpass', 2500);
  }

  /** Small creak while drawing, scaled by power. */
  creak(power: number) {
    this.tone('sawtooth', 70 + power * 60, 60 + power * 50, 0.025, 0.01, 0.05);
  }

  startWhoosh() {
    const ctx = this.ready();
    if (!ctx || !this.noise) return;
    this.stopWhoosh();
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.08);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    this.whooshNode = { src, gain, filter };
  }

  /** speed 0..1 modulates the whoosh while the arrow flies. */
  whoosh(speed: number) {
    if (!this.whooshNode || !this.ctx) return;
    this.whooshNode.filter.frequency.setTargetAtTime(500 + speed * 1600, this.ctx.currentTime, 0.05);
    this.whooshNode.gain.gain.setTargetAtTime(0.03 + speed * 0.12, this.ctx.currentTime, 0.05);
  }

  stopWhoosh() {
    if (!this.whooshNode || !this.ctx) return;
    const { src, gain } = this.whooshNode;
    gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.03);
    src.stop(this.ctx.currentTime + 0.2);
    this.whooshNode = null;
  }

  thud() {
    this.tone('sine', 140, 45, 0.5, 0.003, 0.18);
    this.burst(0.3, 0.1, 'lowpass', 700);
  }

  hit() {
    this.tone('sine', 220, 60, 0.6, 0.003, 0.2);
    this.burst(0.35, 0.12, 'bandpass', 1200, 2);
  }

  headshot() {
    this.hit();
    this.tone('triangle', 1320, 1300, 0.25, 0.005, 0.45, 0.04);
    this.tone('triangle', 1980, 1970, 0.15, 0.005, 0.5, 0.06);
  }

  apple() {
    this.burst(0.4, 0.15, 'bandpass', 2400, 3);
    this.tone('square', 880, 1760, 0.1, 0.005, 0.12);
  }

  pop() {
    this.burst(0.5, 0.09, 'highpass', 1800);
    this.tone('sine', 900, 300, 0.2, 0.002, 0.08);
  }

  win() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.2, 0.01, 0.28, i * 0.11));
  }

  lose() {
    [392, 330, 262].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.18, 0.01, 0.3, i * 0.14));
  }

  tick() {
    this.tone('square', 1200, 1200, 0.04, 0.002, 0.04);
  }

  click() {
    this.tone('triangle', 660, 520, 0.12, 0.003, 0.06);
  }
}

export const sfx = new Sfx();
