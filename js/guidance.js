// Compares the current head orientation with a step's target and turns the
// difference into operator cues, expressed relative to the patient's body.

import {
  angleBetween, cross, DEG, mul, mulTV, mulV, normalize, rotationAngle, rotationVector, scale, transpose,
} from './math3d.js';

const UP = [0, 0, 1];

// Returns { error (deg), turn, chin, tilt } where the components are the rotation
// (deg) still needed, about the body's cranial, transverse and anterior axes:
//   turn > 0 → rotate toward patient's left
//   chin > 0 → chin up (extend)
//   tilt > 0 → tilt toward right shoulder
export function evaluate(R, step) {
  let omegaHead; // radians, head frame
  let error;
  if (step.yawFree) {
    // Only the direction of gravity matters (e.g. seated positions after rolling).
    const uc = mulTV(R, UP);
    const ut = mulTV(step.target, UP);
    error = angleBetween(uc, ut);
    const axis = cross(ut, uc);
    omegaHead = axis[0] || axis[1] || axis[2] ? scale(normalize(axis), error) : [0, 0, 0];
  } else {
    const Rerr = mul(transpose(R), step.target);
    error = rotationAngle(Rerr);
    omegaHead = rotationVector(Rerr);
  }
  const omegaBody = mulTV(step.body, mulV(R, omegaHead));
  return {
    error: error / DEG,
    tilt: omegaBody[1] / DEG,
    turn: omegaBody[2] / DEG,
    chin: omegaBody[0] / DEG,
  };
}

const PHRASES = {
  turn: (v) => (v > 0 ? 'Rotate toward patient’s LEFT' : 'Rotate toward patient’s RIGHT'),
  chin: (v) => (v > 0 ? 'Chin UP (extend)' : 'Chin DOWN (flex)'),
  tilt: (v) => (v > 0 ? 'Tilt toward RIGHT shoulder' : 'Tilt toward LEFT shoulder'),
};

const SPOKEN = {
  turn: (v) => (v > 0 ? 'Rotate left' : 'Rotate right'),
  chin: (v) => (v > 0 ? 'Chin up' : 'Chin down'),
  tilt: (v) => (v > 0 ? 'Tilt to right shoulder' : 'Tilt to left shoulder'),
};

// Largest correction first; ignores components below `minDeg`.
export function cues(ev, minDeg = 5) {
  return ['turn', 'chin', 'tilt']
    .map((k) => ({ key: k, value: ev[k] }))
    .filter((c) => Math.abs(c.value) >= minDeg)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .map((c) => ({
      ...c,
      text: `${PHRASES[c.key](c.value)} ${Math.round(Math.abs(c.value))}°`,
      spoken: `${SPOKEN[c.key](c.value)} ${Math.round(Math.abs(c.value))}`,
    }));
}
