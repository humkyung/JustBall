export class SoundSystem {
  constructor() {
    this._ctx = null;
    this._enabled = true;

    // Lazy-init on first user gesture (browser autoplay policy)
    const init = () => {
      if (!this._ctx) {
        this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      document.removeEventListener('pointerdown', init, true);
      document.removeEventListener('keydown', init, true);
    };
    document.addEventListener('pointerdown', init, true);
    document.addEventListener('keydown', init, true);
  }

  get enabled() { return this._enabled; }
  set enabled(v) { this._enabled = v; }

  _ctx_ready() {
    return this._enabled && this._ctx && this._ctx.state !== 'closed';
  }

  playBounce(speed = 10) {
    if (!this._ctx_ready()) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const freq = Math.min(180 + speed * 18, 900);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.12);
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    osc.start(t);
    osc.stop(t + 0.18);
  }

  playImpact() {
    if (!this._ctx_ready()) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.09);
    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    osc.start(t);
    osc.stop(t + 0.1);
  }

  playExplosion() {
    if (!this._ctx_ready()) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;

    const dur = 0.45;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(150, t + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.45, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(t);
  }

  playBoost() {
    if (!this._ctx_ready()) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, t);
    osc.frequency.exponentialRampToValueAtTime(620, t + 0.18);
    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

    osc.start(t);
    osc.stop(t + 0.22);
  }
}
