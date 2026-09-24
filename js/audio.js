// Voice prompts and a "parking sensor" beeper, so the manoeuvre can be guided
// with the phone's screen hidden inside the headset.

export class Voice {
  constructor() {
    this.enabled = true;
    this.rate = 1;
    this.lang = 'en-IN';
    this.lastSpoken = 0;
  }

  get supported() {
    return 'speechSynthesis' in window;
  }

  say(text, { interrupt = false } = {}) {
    if (!this.enabled || !this.supported || !text) return;
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = this.rate;
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => v.lang === this.lang) || voices.find((v) => v.lang?.startsWith('en')) || null;
    speechSynthesis.speak(u);
    this.lastSpoken = performance.now();
  }

  get speaking() {
    return this.supported && speechSynthesis.speaking;
  }

  stop() {
    if (this.supported) speechSynthesis.cancel();
  }
}

export class Beeper {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.nextBeep = 0;
  }

  // Must be called from a user gesture.
  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx ||= new AC();
    this.ctx.resume?.();
  }

  tone(freq = 880, dur = 0.08, gain = 0.15) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  chime() {
    this.tone(660, 0.12);
    setTimeout(() => this.tone(990, 0.2), 130);
  }

  done() {
    this.tone(880, 0.12);
    setTimeout(() => this.tone(880, 0.12), 180);
    setTimeout(() => this.tone(1320, 0.3), 360);
  }

  // Beeps faster as the error approaches tolerance.
  proximity(error, tol, now) {
    if (now < this.nextBeep) return;
    const x = Math.min(1, Math.max(0, (error - tol) / 75));
    this.tone(520 + (1 - x) * 300, 0.05, 0.1);
    this.nextBeep = now + 120 + x * 900;
  }
}
