// Head orientation from the phone's motion sensors.
//
// `deviceorientation` gives the OS's gyroscope-based fusion (Android game rotation
// vector / iOS Core Motion attitude); `devicemotion.rotationRate` gives raw gyroscope
// angular velocity, used for stillness detection and movement speed.
//
// Calibration (patient upright, looking straight ahead) fixes the world frame
// W = (right, forward, up) and the phone-to-head mounting rotation.

import {
  cross, fromColumns, fromDeviceOrientation, I3, mul, mulV, normalize, transpose,
} from './math3d.js';

// Nose direction in phone coordinates (x right of screen, y up the screen, z out of the screen).
export const MOUNTS = {
  goggle: [0, 0, -1], // screen faces the eyes (VR-style headset): front camera films the eyes
  forehead: [0, 0, 1], // screen faces outward on the forehead: clinician can read it
};

export class HeadTracker {
  constructor() {
    this.Rfd = null; // earth <- device
    this.rate = 0; // smoothed angular speed, deg/s
    this.peakRate = 0;
    this.lastEvent = 0;
    this.RfW = null;
    this.RdH = null;
    this.demoHead = null; // when set, bypasses sensors (desk testing)
    this._onOri = this._onOri.bind(this);
    this._onMotion = this._onMotion.bind(this);
    this._prevR = null;
    this._prevT = 0;
    this.gotMotion = false;
  }

  static async requestPermission() {
    const asks = [];
    for (const E of [window.DeviceOrientationEvent, window.DeviceMotionEvent]) {
      if (E && typeof E.requestPermission === 'function') asks.push(E.requestPermission());
    }
    const res = await Promise.all(asks);
    return res.every((r) => r === 'granted');
  }

  start() {
    window.addEventListener('deviceorientation', this._onOri, true);
    window.addEventListener('devicemotion', this._onMotion, true);
  }

  _onOri(e) {
    if (e.alpha == null && e.beta == null && e.gamma == null) return;
    const R = fromDeviceOrientation(e.alpha || 0, e.beta || 0, e.gamma || 0);
    const now = performance.now();
    // Without devicemotion (rare), derive angular speed from successive orientations.
    if (!this.gotMotion && this._prevR && now > this._prevT) {
      const Rd = mul(transpose(this._prevR), R);
      const th = Math.acos(Math.max(-1, Math.min(1, (Rd[0] + Rd[4] + Rd[8] - 1) / 2)));
      this._updateRate((th * 180) / Math.PI / ((now - this._prevT) / 1000));
    }
    this._prevR = R;
    this._prevT = now;
    this.Rfd = R;
    this.lastEvent = now;
  }

  _onMotion(e) {
    const r = e.rotationRate;
    if (!r || r.alpha == null) return;
    this.gotMotion = true;
    this._updateRate(Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0));
  }

  _updateRate(v) {
    if (!Number.isFinite(v)) return;
    this.rate = this.rate * 0.7 + v * 0.3;
    this.peakRate = Math.max(this.peakRate, v);
  }

  resetPeak() {
    this.peakRate = 0;
  }

  get live() {
    return !!this.demoHead || (!!this.Rfd && performance.now() - this.lastEvent < 1000);
  }

  get calibrated() {
    return !!this.demoHead || !!this.RdH;
  }

  // Returns { ok, message }.
  calibrate(mount) {
    if (this.demoHead) {
      this.demoHead = I3();
      return { ok: true };
    }
    if (!this.Rfd) return { ok: false, message: 'No motion sensor data.' };
    const noseE = mulV(this.Rfd, MOUNTS[mount] || MOUNTS.goggle);
    if (Math.abs(noseE[2]) > 0.8) {
      return {
        ok: false,
        message: 'The phone’s facing axis is nearly vertical. Check the mount setting and that the patient is upright.',
      };
    }
    const up = [0, 0, 1];
    const fwd = normalize([noseE[0], noseE[1], 0]);
    const right = cross(fwd, up);
    this.RfW = fromColumns(right, fwd, up);
    this.RdH = mul(transpose(this.Rfd), this.RfW);
    return { ok: true };
  }

  // R_world<-head.
  head() {
    if (this.demoHead) return this.demoHead;
    if (!this.Rfd || !this.RdH) return I3();
    return mul(mul(transpose(this.RfW), this.Rfd), this.RdH);
  }
}
