export class SoundSystem {
  constructor() {
    this._ctx = null;
    this._enabled = true;
    this._bgmPlaying = false;
    this._bgmAudio = null;

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
  get bgmPlaying() { return this._bgmPlaying; }

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

  playImpact(intensity = 0.5) {
    if (!this._ctx_ready()) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'triangle';
    const freq = 100 + intensity * 120;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.09);
    gain.gain.setValueAtTime(0.06 + intensity * 0.1, t);
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

  playLineBreak() {
    if (!this._ctx_ready()) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;

    // Crunchy break sound: short noise burst + low thud
    const dur = 0.2;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(600, t);
    filter.Q.setValueAtTime(2, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(t);

    // Low thud
    const osc = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc.connect(gain2);
    gain2.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.15);
    gain2.gain.setValueAtTime(0.2, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  playBombExplode() {
    if (!this._ctx_ready()) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;

    // Big explosion: longer noise + deeper rumble
    const dur = 0.8;
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
    filter.frequency.setValueAtTime(1200, t);
    filter.frequency.exponentialRampToValueAtTime(80, t + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(t);

    // Deep rumble
    const osc = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc.connect(gain2);
    gain2.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(60, t);
    osc.frequency.exponentialRampToValueAtTime(20, t + 0.5);
    gain2.gain.setValueAtTime(0.3, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  playLaunch(power = 0.5) {
    if (!this._ctx_ready()) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;

    // Whoosh: filtered noise burst
    const dur = 0.15 + power * 0.15;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800 + power * 1200, t);
    filter.Q.setValueAtTime(1.5, t);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2 + power * 0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(t);

    // Rising tone
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300 + power * 200, t);
    osc.frequency.exponentialRampToValueAtTime(600 + power * 400, t + 0.1);
    oscGain.gain.setValueAtTime(0.12, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  // --- BGM (MP3 file) ---
  toggleBGM() {
    if (this._bgmPlaying) {
      this.stopBGM();
    } else {
      this.startBGM();
    }
    return this._bgmPlaying;
  }

  startBGM() {
    if (this._bgmPlaying) return;
    this._bgmPlaying = true;

    if (!this._bgmAudio) {
      this._bgmAudio = new Audio('/bgm.mp3');
      this._bgmAudio.loop = true;
      this._bgmAudio.volume = 0.3;
    }

    this._bgmAudio.play().catch(() => {
      // Autoplay blocked — will retry on next user gesture
      this._bgmPlaying = false;
    });
  }

  stopBGM() {
    this._bgmPlaying = false;
    if (this._bgmAudio) {
      this._bgmAudio.pause();
      this._bgmAudio.currentTime = 0;
    }
  }
}
