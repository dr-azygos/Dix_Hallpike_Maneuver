// Target head orientations for the Dix-Hallpike test and the Epley manoeuvre.
//
// World frame (fixed at calibration, patient seated on the couch facing its foot end):
//   X = patient's right, Y = forward (toward the foot of the couch), Z = up.
// Head frame: x = right ear, y = nose, z = vertex. Calibration pose = identity.
// Body frame: x = right, y = chest (anterior), z = cranial.
// Every target is body * neck, so guidance can be phrased relative to the body.
//
// Conventions: rotZ(+) turns the nose to the patient's LEFT, rotX(+) lifts the chin
// (extension), rotY(+) tilts the vertex toward the RIGHT shoulder.

import { I3, mul, rotX, rotY, rotZ } from './math3d.js';

export const SIDES = { right: 'right', left: 'left' };
const other = (side) => (side === 'right' ? 'left' : 'right');
const sign = (side) => (side === 'right' ? 1 : -1);

const cap = (s) => s[0].toUpperCase() + s.slice(1);

function pose(def) {
  const body = def.body || I3();
  const neck = def.neck || I3();
  return { type: 'pose', strict: true, yawFree: false, ...def, body, neck, target: mul(body, neck) };
}

export function calibrateStep(extra = {}) {
  return {
    type: 'calibrate',
    id: 'calibrate',
    title: 'Calibrate',
    instruction:
      'Patient sits upright on the couch, facing its foot end, looking straight ahead. Keep the head still.',
    speech: 'Sit upright, facing the foot of the couch, and look straight ahead. Keep still.',
    hold: 2.5,
    ...extra,
  };
}

export function restStep(seconds, extra = {}) {
  return {
    type: 'rest',
    id: 'rest',
    title: 'Rest',
    instruction: 'Let the patient rest seated before the next side.',
    speech: `Rest for ${seconds} seconds.`,
    hold: seconds,
    ...extra,
  };
}

// Dix-Hallpike for one side. Recording runs from the moment the patient lies back
// until the end of the sit-up observation.
export function dixHallpikeSteps(side, cfg) {
  const s = sign(side);
  const S = cap(side);
  const ext = cfg.extension;
  return [
    pose({
      id: `dh-${side}-turn`,
      title: `${S} Dix-Hallpike · turn head`,
      instruction: `Seated. Turn the head 45° to the ${side}.`,
      speech: `Turn the head 45 degrees to the ${side}.`,
      neck: rotZ(-s * 45),
      hold: 2,
    }),
    pose({
      id: `dh-${side}-hang`,
      title: `${S} Dix-Hallpike · head hanging`,
      instruction: `Lie the patient back briskly. Head hangs ${ext}° below the couch, still turned 45° ${side}. Eyes open. Watch for nystagmus.`,
      speech: `Now lie back quickly. Head hanging, turned to the ${side}. Keep the eyes open.`,
      body: rotX(90 + ext),
      neck: rotZ(-s * 45),
      hold: cfg.dhObserve,
      strict: false,
      recordStart: `${S} Dix-Hallpike`,
      markOnReach: 'Head-hanging position reached',
      timeTransition: true,
    }),
    pose({
      id: `dh-${side}-sit`,
      title: `${S} Dix-Hallpike · sit up`,
      instruction: 'Bring the patient back up to sitting. Watch for reversal nystagmus.',
      speech: 'Now sit the patient up slowly. Keep the eyes open.',
      yawFree: true,
      hold: cfg.dhSitObserve,
      strict: false,
      markOnReach: 'Sitting position reached',
      recordStop: true,
    }),
  ];
}

export function dixHallpikeProtocol(sides, cfg) {
  const steps = [calibrateStep()];
  sides.forEach((side, i) => {
    if (i > 0) {
      steps.push(restStep(cfg.restBetween));
      steps.push(calibrateStep({ id: 'recalibrate' }));
    }
    steps.push(...dixHallpikeSteps(side, cfg));
  });
  return steps;
}

// Epley (canalith repositioning) for posterior canal BPPV on `side`.
export function epleySteps(side, cfg) {
  const s = sign(side);
  const o = other(side);
  const ext = cfg.extension;
  const hold = cfg.hold;
  const record = cfg.record ? `Epley ${cap(side)}` : null;
  return [
    pose({
      id: 'ep-1-turn',
      title: '1 · Turn head',
      instruction: `Seated. Turn the head 45° to the ${side} (affected side).`,
      speech: `Turn the head 45 degrees to the ${side}.`,
      neck: rotZ(-s * 45),
      hold: 2,
    }),
    pose({
      id: 'ep-2-hang',
      title: '2 · Lie back, head hanging',
      instruction: `Lie back quickly. Head hangs ${ext}° below the couch, still turned 45° ${side}.`,
      speech: `Lie back quickly, head hanging, still turned to the ${side}.`,
      body: rotX(90 + ext),
      neck: rotZ(-s * 45),
      hold,
      recordStart: record,
      markOnReach: 'Position 2 (head hanging) reached',
      timeTransition: true,
    }),
    pose({
      id: 'ep-3-turn',
      title: '3 · Turn head 90° to other side',
      instruction: `Keep the head extended and rotate it 90° to the ${o}, so it faces 45° ${o}.`,
      speech: `Turn the head slowly 90 degrees to the ${o}. Keep it extended.`,
      body: rotX(90 + ext),
      neck: rotZ(s * 45),
      hold,
      markOnReach: 'Position 3 (head turned) reached',
    }),
    pose({
      id: 'ep-4-roll',
      title: `4 · Roll onto ${o} side`,
      instruction: `Roll the patient onto the ${o} side. The head turns with the body so the nose points 45° toward the floor.`,
      speech: `Roll onto the ${o} side. Nose pointing down toward the floor.`,
      body: mul(rotY(-s * 90), rotX(90)),
      neck: rotZ(s * 45),
      hold,
      markOnReach: 'Position 4 (side-lying) reached',
    }),
    pose({
      id: 'ep-5-sit',
      title: '5 · Sit up',
      instruction: `Sit the patient up on the ${o} side of the couch, head still turned.`,
      speech: 'Sit up slowly, keeping the head turned.',
      neck: rotZ(s * 45),
      yawFree: true,
      hold: 10,
      markOnReach: 'Sitting reached',
    }),
    pose({
      id: 'ep-6-chin',
      title: '6 · Head centre, chin down',
      instruction: 'Bring the head to the midline and tilt the chin down 20°.',
      speech: 'Bring the head to the centre, chin down.',
      neck: rotX(-20),
      yawFree: true,
      hold: 10,
      recordStop: !!record,
    }),
  ];
}

export function epleyProtocol(side, cfg) {
  return [calibrateStep(), ...epleySteps(side, cfg)];
}

// Interpretation of Dix-Hallpike findings for one side.
export function interpret(finding, side) {
  const S = cap(side);
  switch (finding.pattern) {
    case 'none':
      return { level: 'neg', text: `${S} Dix-Hallpike negative.` };
    case 'upbeat-torsional': {
      const long = Number(finding.duration) > 60;
      return {
        level: 'pos',
        treat: side,
        text:
          `Upbeating torsional (geotropic) nystagmus on the ${side}: consistent with ${S} posterior canal BPPV` +
          (long
            ? ' — duration over 60 s suggests cupulolithiasis; repositioning may need repeating.'
            : ' (canalithiasis). Epley manoeuvre for the ' + side + ' is indicated.'),
      };
    }
    case 'horizontal-geo':
    case 'horizontal-apo':
      return {
        level: 'warn',
        text: 'Horizontal nystagmus suggests horizontal (lateral) canal BPPV. Do a supine roll test; Epley is not the right manoeuvre (consider barbecue roll or Gufoni).',
      };
    case 'downbeat':
      return {
        level: 'alert',
        text: 'Downbeating nystagmus: consider anterior canal BPPV, but exclude a central cause (non-fatiguing, no latency, no vertigo, other neurological signs are red flags).',
      };
    case 'other':
      return { level: 'warn', text: 'Atypical nystagmus: review the recording and consider a central cause.' };
    default:
      return { level: 'none', text: '' };
  }
}
