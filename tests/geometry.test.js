import test from 'node:test';
import assert from 'node:assert/strict';
import {
  axisAngle, col, fromColumns, fromDeviceOrientation, I3, mul, rotationAngle, rotationVector, rotX, rotY, rotZ, transpose, DEG,
} from '../js/math3d.js';
import { dixHallpikeProtocol, epleyProtocol, interpret } from '../js/protocols.js';
import { evaluate, cues } from '../js/guidance.js';
import { HeadTracker } from '../js/tracker.js';

const cfg = { extension: 20, hold: 30, dhObserve: 45, dhSitObserve: 20, restBetween: 30, record: true };
const close = (a, b, eps = 1e-6) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${a} vs ${b}`));
const nose = (R) => col(R, 1);
const vertex = (R) => col(R, 2);
const rightEar = (R) => col(R, 0);
const step = (steps, id) => steps.find((s) => s.id === id);

test('rotationVector round-trips axis-angle, including near 180°', () => {
  for (const [axis, deg] of [[[1, 2, 3], 37], [[0, 0, 1], 179.99], [[1, -1, 0], 180], [[0, 1, 0], 0.0001]]) {
    const R = axisAngle(axis, deg);
    const v = rotationVector(R);
    close(mul(axisAngle(v, Math.hypot(...v) / DEG), transpose(R)), I3(), 1e-6);
  }
});

test('device orientation matches W3C examples', () => {
  // Flat, screen up, top pointing north: identity.
  close(fromDeviceOrientation(0, 0, 0), I3());
  // Upright portrait (beta 90): screen normal (z) points south → -Y.
  close(col(fromDeviceOrientation(0, 90, 0), 2), [0, -1, 0]);
});

test('Epley right: positions match the textbook geometry', () => {
  const steps = epleyProtocol('right', cfg);
  const s1 = step(steps, 'ep-1-turn').target;
  close(nose(s1), [Math.SQRT1_2, Math.SQRT1_2, 0]); // nose 45° to the right

  const s2 = step(steps, 'ep-2-hang').target;
  assert.ok(vertex(s2)[2] < -0.3, 'vertex below horizontal (head hanging)');
  assert.ok(vertex(s2)[1] < -0.9, 'vertex points to the head end of the couch');
  assert.ok(nose(s2)[0] > 0.6, 'nose turned to the right');
  assert.ok(rightEar(s2)[2] < -0.6, 'right (affected) ear down');

  const s3 = step(steps, 'ep-3-turn').target;
  assert.ok(nose(s3)[0] < -0.6, 'nose turned to the left');
  assert.ok(rightEar(s3)[2] > 0.6, 'right ear up');

  const s4 = step(steps, 'ep-4-roll').target;
  close(nose(s4), [-Math.SQRT1_2, 0, -Math.SQRT1_2]); // lying on left side, nose 45° to floor

  const s6 = step(steps, 'ep-6-chin').target;
  assert.ok(nose(s6)[2] < -0.3, 'chin down');
});

test('Epley left mirrors Epley right', () => {
  const r = step(epleyProtocol('right', cfg), 'ep-4-roll').target;
  const l = step(epleyProtocol('left', cfg), 'ep-4-roll').target;
  const n = nose(l);
  close([-n[0], n[1], n[2]], nose(r));
});

test('Dix-Hallpike: both sides with recalibration and one recording per side', () => {
  const steps = dixHallpikeProtocol(['right', 'left'], cfg);
  assert.equal(steps.filter((s) => s.type === 'calibrate').length, 2);
  assert.equal(steps.filter((s) => s.recordStart).length, 2);
  assert.equal(steps.filter((s) => s.recordStop).length, 2);
  const hangL = step(steps, 'dh-left-hang').target;
  assert.ok(col(hangL, 1)[0] < -0.6, 'left: nose turned left');
});

test('evaluate: zero error at target and sensible body-frame cues', () => {
  const steps = epleyProtocol('right', cfg);
  const hang = step(steps, 'ep-2-hang');
  assert.ok(evaluate(hang.target, hang).error < 1e-6);

  // Supine without extension (head turned right): only "chin up 20" is needed.
  const flat = mul(rotX(90), rotZ(-45));
  const ev = evaluate(flat, hang);
  assert.ok(Math.abs(ev.error - 20) < 1e-6);
  assert.ok(Math.abs(ev.chin - 20) < 1e-6 && Math.abs(ev.turn) < 1e-6 && Math.abs(ev.tilt) < 1e-6);
  assert.match(cues(ev)[0].text, /Chin UP/);

  // Seated, head turned only 25° right: rotate further right by 20.
  const turn = step(steps, 'ep-1-turn');
  const ev2 = evaluate(rotZ(-25), turn);
  assert.ok(Math.abs(ev2.turn + 20) < 1e-6);
  assert.match(cues(ev2)[0].text, /RIGHT/);

  // Yaw-free step ignores rotation about the vertical.
  const chin = step(steps, 'ep-6-chin');
  assert.ok(evaluate(mul(rotZ(70), rotX(-20)), chin).error < 1e-6);
  const tilted = evaluate(mul(rotY(15), rotX(-20)), chin);
  assert.ok(Math.abs(tilted.error - 15) < 1e-6 && tilted.tilt < -14);
});

test('tracker: calibration makes upright head the identity and tracks head motion', () => {
  const t = new HeadTracker();
  // Goggle mount, phone in landscape: device x = up, device y = patient's left, z toward face.
  // Patient faces north (earth +Y). Columns = device axes in earth coords.
  const mount = fromColumns([0, 0, 1], [-1, 0, 0], [0, -1, 0]);
  t.Rfd = mount;
  assert.ok(t.calibrate('goggle').ok);
  close(t.head(), I3());
  // Patient turns head 45° right (earth rotation about up by -45°).
  t.Rfd = mul(rotZ(-45), mount);
  close(nose(t.head()), [Math.SQRT1_2, Math.SQRT1_2, 0]);
  // Patient lies back 90°.
  t.Rfd = mul(rotX(90), mount);
  close(nose(t.head()), [0, 0, 1]);
  // Wrong mount type is caught when the facing axis is vertical.
  t.Rfd = I3();
  assert.equal(t.calibrate('goggle').ok, false);
});

test('interpretation', () => {
  assert.equal(interpret({ pattern: 'upbeat-torsional', duration: 20 }, 'left').treat, 'left');
  assert.equal(interpret({ pattern: 'downbeat' }, 'right').level, 'alert');
  assert.equal(interpret({ pattern: 'none' }, 'right').level, 'neg');
});
