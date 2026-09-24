// Drives a list of steps: waits for each target head position, times the hold,
// gives voice/beep cues, and starts/stops the eye recording.

import { evaluate, cues } from './guidance.js';

const STILL_DEG_S = 10;
const CUE_INTERVAL_MS = 4000;

export class Runner {
  constructor({ steps, tracker, recorder, voice, beeper, settings, onUpdate, onVideo, onDone }) {
    Object.assign(this, { steps, tracker, recorder, voice, beeper, settings, onUpdate, onVideo, onDone });
    this.i = -1;
    this.log = [];
    this.paused = false;
    this.finished = false;
    this.pending = Promise.resolve();
    this._loop = this._loop.bind(this);
  }

  get step() {
    return this.steps[this.i];
  }

  start() {
    this.last = performance.now();
    this._enter(0);
    this._raf = requestAnimationFrame(this._loop);
    // rAF pauses when the page is hidden; keep ticking slowly so timers stay honest.
    this._iv = setInterval(() => document.hidden && this.tick(performance.now()), 250);
  }

  _loop(now) {
    if (this.finished) return;
    this.tick(now);
    this._raf = requestAnimationFrame(this._loop);
  }

  _enter(i) {
    this.i = i;
    const st = this.step;
    const now = performance.now();
    this.s = {
      start: now,
      reached: false,
      reachedAt: 0,
      held: 0,
      still: 0,
      errSum: 0,
      n: 0,
      inTolTime: 0,
      lastCue: now + 1500,
      announced10: false,
      lastTick: 0,
      message: '',
    };
    this.tracker.resetPeak();
    if (st.recordStart && this.recorder?.stream) {
      this.recorder.start(st.recordStart);
      this.recorder.mark(st.title);
    }
    this.voice.say(st.speech, { interrupt: true });
  }

  tick(now) {
    const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.finished || this.i < 0) return;
    const st = this.step;
    const s = this.s;
    let ev = null;
    let inTol = false;

    if (!this.paused) {
      if (st.type === 'calibrate') {
        s.still = this.tracker.rate < STILL_DEG_S ? s.still + dt : 0;
        if (s.still >= st.hold) {
          const res = this.tracker.calibrate(this.settings.mount);
          if (res.ok) return this._finish();
          s.message = res.message;
          s.still = 0;
          if (now - s.lastCue > CUE_INTERVAL_MS) {
            this.voice.say('Calibration failed. ' + res.message);
            s.lastCue = now;
          }
        }
      } else if (st.type === 'rest') {
        s.held += dt;
        this._countdown(st, now);
        if (s.held >= st.hold) return this._finish();
      } else {
        ev = evaluate(this.tracker.head(), st);
        const tol = this.settings.tolerance;
        inTol = ev.error <= tol;
        if (!s.reached && inTol) {
          s.reached = true;
          s.reachedAt = now;
          s.transition = (now - s.start) / 1000;
          if (st.markOnReach) this.recorder?.mark(st.markOnReach);
          this.beeper.chime();
          this.voice.say(st.strict ? 'Good. Hold.' : 'Position reached. Observe.', { interrupt: true });
        }
        if (s.reached) {
          if (st.strict ? inTol : true) s.held += dt;
          s.errSum += ev.error * dt;
          s.n += dt;
          if (inTol) s.inTolTime += dt;
        }
        if (!inTol) {
          this.beeper.proximity(ev.error, tol, now);
          if (now - s.lastCue > CUE_INTERVAL_MS && !this.voice.speaking) {
            const c = cues(ev, Math.max(4, tol / 2))[0];
            if (c) this.voice.say(s.reached && st.strict ? 'Back to position. ' + c.spoken : c.spoken);
            s.lastCue = now;
          }
        } else if (s.reached) {
          this._countdown(st, now);
        }
        if (s.held >= st.hold) return this._finish();
      }
    }

    this.onUpdate?.({
      step: st,
      index: this.i,
      total: this.steps.length,
      ev,
      inTol,
      paused: this.paused,
      held: s.held,
      still: s.still,
      reached: s.reached,
      message: s.message,
      rate: this.tracker.rate,
      rec: this.recorder?.recording ? this.recorder.elapsed() : null,
      head: this.tracker.head(),
    });
  }

  _countdown(st, now) {
    const left = st.hold - this.s.held;
    if (st.hold >= 20 && left <= 10 && !this.s.announced10) {
      this.s.announced10 = true;
      this.voice.say('Ten seconds.');
    }
    if (left <= 5 && now - this.s.lastTick > 1000) {
      this.s.lastTick = now;
      this.beeper.tone(1000, 0.04, 0.08);
    }
  }

  _finish(skipped = false) {
    const st = this.step;
    const s = this.s;
    const now = performance.now();
    this.log.push({
      id: st.id,
      title: st.title,
      type: st.type,
      skipped,
      duration: +((now - s.start) / 1000).toFixed(1),
      reachedAfter: s.reached ? +s.transition.toFixed(1) : null,
      held: +s.held.toFixed(1),
      meanError: s.n ? +(s.errSum / s.n).toFixed(1) : null,
      inTolPct: s.n ? Math.round((100 * s.inTolTime) / s.n) : null,
      peakRate: Math.round(this.tracker.peakRate),
    });
    if (st.recordStop && this.recorder?.recording) {
      this.pending = this.pending.then(() => this.recorder.stop()).then((v) => v && this.onVideo?.(v));
    }
    if (this.i + 1 >= this.steps.length) return this._complete(false);
    if (st.type !== 'calibrate') this.beeper.done();
    this._enter(this.i + 1);
  }

  skip() {
    if (!this.finished) this._finish(true);
  }

  togglePause() {
    this.paused = !this.paused;
    this.voice.say(this.paused ? 'Paused.' : 'Resumed. ' + (this.step.speech || ''), { interrupt: true });
    return this.paused;
  }

  recalibrate() {
    const cal = this.steps.findIndex((s) => s.type === 'calibrate');
    this.steps.splice(this.i, 0, { ...this.steps[cal], id: 'recalibrate' });
    this._enter(this.i);
  }

  abort() {
    if (this.finished) return;
    if (this.recorder?.recording) {
      this.recorder.mark('Aborted');
      this.pending = this.pending.then(() => this.recorder.stop()).then((v) => v && this.onVideo?.(v));
    }
    this._complete(true);
  }

  async _complete(aborted) {
    this.finished = true;
    cancelAnimationFrame(this._raf);
    clearInterval(this._iv);
    if (!aborted) this.voice.say('Procedure complete.', { interrupt: true });
    else this.voice.stop();
    await this.pending;
    this.onDone?.({ aborted, log: this.log });
  }
}
