import { HeadTracker } from './tracker.js';
import { EyeRecorder, extForMime, fixDuration } from './recorder.js';
import { Voice, Beeper } from './audio.js';
import { Runner } from './runner.js';
import { cues } from './guidance.js';
import { drawHead } from './viz.js';
import { dixHallpikeProtocol, epleyProtocol, interpret } from './protocols.js';
import { mul, rotX, rotY, rotZ } from './math3d.js';
import * as store from './storage.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- settings ----------
const DEFAULTS = {
  tolerance: 15,
  extension: 20,
  hold: 30,
  dhObserve: 45,
  dhSitObserve: 20,
  restBetween: 30,
  voice: true,
  beeps: true,
  voiceRate: 1,
  lightDefault: true,
  light: 35,
  recordEpley: true,
  fps: 60,
  demo: false,
  mount: 'goggle',
  eyeMode: 'camera',
};
let settings = { ...DEFAULTS };
try {
  settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('bppv-settings') || '{}') };
} catch { /* storage unavailable */ }
function saveSettings() {
  try {
    localStorage.setItem('bppv-settings', JSON.stringify(settings));
  } catch { /* storage unavailable */ }
}

// ---------- services ----------
const tracker = new HeadTracker();
const recorder = new EyeRecorder($('#cam'));
const voice = new Voice();
const beeper = new Beeper();
tracker.start();
if (settings.demo) tracker.demoHead = [1, 0, 0, 0, 1, 0, 0, 0, 1];

let setup = { proc: 'dh', side: 'both' };
let runner = null;
let session = null;
let wakeLock = null;

// ---------- navigation ----------
const navStack = [];
function go(name, { push = true } = {}) {
  const cur = $('.screen.active');
  if (push && cur && cur.id !== 'screen-' + name && cur.id !== 'screen-run') navStack.push(cur.id.slice(7));
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  const scr = $('#screen-' + name);
  $('#page-title').textContent = scr.dataset.title || 'BPPV Assistant';
  $('#back').hidden = name === 'home';
  $('#topbar').hidden = name === 'run';
  window.scrollTo(0, 0);
  if (name !== 'setup' && name !== 'run') stopPreview();
  ({ setup: renderSetup, sessions: renderSessions, settings: renderSettings }[name] || (() => {}))();
}
$('#back').addEventListener('click', () => go(navStack.pop() || 'home', { push: false }));
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (!b) return;
  if (b.dataset.proc) setup = { proc: b.dataset.proc, side: b.dataset.side || 'both' };
  go(b.dataset.go);
});

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), ms);
}

// ---------- sensor status ----------
setInterval(() => {
  const pill = $('#sensor-pill');
  const live = tracker.live;
  pill.textContent = settings.demo ? 'demo' : live ? `sensors ✓ ${Math.round(tracker.rate)}°/s` : 'sensors —';
  pill.classList.toggle('live', live);
  const st = $('#sensor-status');
  if (st && $('#screen-setup').classList.contains('active')) {
    if (settings.demo) setStatus(st, 'Demo mode: head position is simulated with sliders.', 'ok');
    else if (live) setStatus(st, `Receiving gyroscope data · angular speed ${Math.round(tracker.rate)}°/s`, 'ok');
    else setStatus(st, 'No motion data yet. Tap “Enable motion sensors”. Needs HTTPS and a phone with a gyroscope.', 'bad');
    $('#enable-sensors').hidden = live || settings.demo;
    updateStartState();
  }
}, 500);

function setStatus(el, text, cls) {
  el.textContent = text;
  el.className = 'status ' + (cls || '');
}

$('#enable-sensors').addEventListener('click', async () => {
  try {
    const ok = await HeadTracker.requestPermission();
    if (!ok) toast('Motion permission denied. Allow it in browser settings.');
  } catch (e) {
    toast('Could not enable sensors: ' + e.message);
  }
});

// ---------- setup ----------
function renderSetup() {
  const dh = setup.proc === 'dh';
  $('#screen-setup').dataset.title = dh ? 'Dix-Hallpike setup' : `Epley setup · ${cap(setup.side)} ear`;
  $('#page-title').textContent = $('#screen-setup').dataset.title;
  const opts = dh
    ? [['both', 'Both', 'right, then left'], ['right', 'Right'], ['left', 'Left']]
    : [['right', 'Right ear'], ['left', 'Left ear']];
  if (!opts.some(([v]) => v === setup.side)) setup.side = opts[0][0];
  $('#side-seg').innerHTML = opts
    .map(([v, l, sub]) => `<button data-side="${v}" class="${v === setup.side ? 'on' : ''}">${l}${sub ? `<small>${sub}</small>` : ''}</button>`)
    .join('');
  $$('#mount-seg button').forEach((b) => b.classList.toggle('on', b.dataset.mount === settings.mount));
  const eye = eyeMode();
  $$('#eye-seg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.eye === eye);
    b.disabled = b.dataset.eye === 'camera' && settings.mount !== 'goggle';
  });
  $('#eye-field').hidden = !dh;
  $('#camera-panel').hidden = !wantsVideo();
  updateStartState();
}

$('#side-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setup.side = b.dataset.side;
  renderSetup();
});
$('#mount-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  settings.mount = b.dataset.mount;
  saveSettings();
  if (settings.mount !== 'goggle') stopPreview();
  renderSetup();
});
$('#eye-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  settings.eyeMode = b.dataset.eye;
  saveSettings();
  if (settings.eyeMode !== 'camera') stopPreview();
  renderSetup();
});
$('#safety-ok').addEventListener('change', updateStartState);

// The camera faces the eyes only in the headset; on the forehead findings are always manual.
function eyeMode() {
  return settings.mount === 'goggle' ? settings.eyeMode : 'manual';
}

function wantsVideo() {
  if (settings.mount !== 'goggle') return false;
  return setup.proc === 'dh' ? eyeMode() === 'camera' : settings.recordEpley;
}

function updateStartState() {
  const ready = $('#safety-ok').checked && (tracker.live || settings.demo);
  $('#start').disabled = !ready;
  const hint = !$('#safety-ok').checked
    ? 'Complete the safety screen to start.'
    : !(tracker.live || settings.demo)
      ? 'Waiting for motion sensors.'
      : setup.proc === 'dh' && eyeMode() === 'manual'
        ? 'After Start, watch the eyes yourself and tap Onset / End on screen during the observation.'
        : settings.mount === 'goggle'
        ? 'After Start, put the phone in the headset. Voice prompts will guide you.'
        : 'After Start, strap the phone to the forehead, screen facing you.';
  $('#start-hint').textContent = hint;
}

async function openCamera() {
  if (!recorder.supported) throw new Error('Camera recording is not supported in this browser.');
  await recorder.open({ fps: settings.fps });
  const s = recorder.settings();
  return `${s.width || '?'}×${s.height || '?'} at ${Math.round(s.frameRate || 0) || '?'} fps`;
}

$('#check-camera').addEventListener('click', async () => {
  const st = $('#camera-status');
  try {
    const info = await openCamera();
    const pv = $('#preview');
    pv.srcObject = recorder.stream;
    await pv.play().catch(() => {});
    $('#preview-box').hidden = false;
    setStatus(st, `Camera ready · ${info}. Centre both eyes in the guides.`, 'ok');
  } catch (e) {
    setStatus(st, 'Camera unavailable: ' + e.message, 'bad');
  }
});

function stopPreview() {
  const pv = $('#preview');
  if (pv) pv.srcObject = null;
  $('#preview-box').hidden = true;
  if (!runner || runner.finished) recorder.close();
}

$('#start').addEventListener('click', async () => {
  beeper.unlock();
  voice.enabled = settings.voice;
  voice.rate = settings.voiceRate;
  beeper.enabled = settings.beeps;
  voice.say(' '); // unlocks speech on iOS inside the gesture
  if (!settings.demo && !tracker.live) {
    try {
      await HeadTracker.requestPermission();
    } catch { /* not iOS */ }
  }
  if (wantsVideo()) {
    try {
      await openCamera();
    } catch (e) {
      if (!confirm(`Camera unavailable (${e.message}). Continue without eye recording?`)) return;
    }
  }
  store.persist();
  startProcedure();
});

function cap(s) {
  return s[0].toUpperCase() + s.slice(1);
}

// ---------- run ----------
function protocolCfg() {
  return {
    extension: settings.extension,
    hold: settings.hold,
    dhObserve: settings.dhObserve,
    dhSitObserve: settings.dhSitObserve,
    restBetween: settings.restBetween,
    record: settings.recordEpley,
  };
}

async function startProcedure() {
  const dh = setup.proc === 'dh';
  const sides = dh ? (setup.side === 'both' ? ['right', 'left'] : [setup.side]) : [setup.side];
  const steps = dh ? dixHallpikeProtocol(sides, protocolCfg()) : epleyProtocol(setup.side, protocolCfg());
  session = {
    id: store.uid(),
    type: dh ? 'dh' : 'epley',
    created: Date.now(),
    patient: $('#patient').value.trim(),
    sides,
    mount: settings.mount,
    manual: dh && !wantsVideo(),
    settings: { ...protocolCfg(), tolerance: settings.tolerance },
    videoIds: [],
    findings: {},
    log: [],
  };
  await store.saveSession(session).catch(() => {});

  $('#run-steps').innerHTML = steps
    .filter((s) => s.type !== 'rest')
    .map((s) => `<li data-id="${s.id}">${s.type === 'calibrate' ? 'Calibrate' : s.title.replace(/^.*·\s*/, '')}</li>`)
    .join('');
  $('#demo').hidden = !settings.demo;
  document.documentElement.style.setProperty('--light', settings.light + '%');
  setLight(wantsVideo() && settings.lightDefault && !settings.demo);
  go('run');
  requestWakeLock();

  runner = new Runner({
    steps,
    tracker,
    recorder,
    voice,
    beeper,
    settings,
    onUpdate: renderRun,
    onVideo: saveRecording,
    onDone: finishProcedure,
  });
  runner.start();
}

function setLight(on) {
  $('#screen-run').classList.toggle('light', on);
}
$('#lightfield').addEventListener('click', () => {
  setLight(false);
  clearTimeout(setLight.t);
  if (settings.lightDefault && wantsVideo()) setLight.t = setTimeout(() => setLight(true), 15000);
});
$('#run-light').addEventListener('click', () => setLight(true));
$('#run-pause').addEventListener('click', (e) => {
  e.target.textContent = runner.togglePause() ? 'Resume' : 'Pause';
});
$('#run-skip').addEventListener('click', () => runner.skip());
$('#run-recal').addEventListener('click', () => runner.recalibrate());
$('#run-abort').addEventListener('click', () => {
  if (confirm('Stop the procedure? Any recording so far is saved.')) runner.abort();
});

const DIAL_LEN = 326.7;
const SHORT = {
  turn: (v) => (v > 0 ? '← to left' : 'to right →'),
  chin: (v) => (v > 0 ? 'chin up' : 'chin down'),
  tilt: (v) => (v > 0 ? 'to R shoulder' : 'to L shoulder'),
};
let lastStepId = null;
function renderRun(u) {
  const { step } = u;
  if (step.id + u.index !== lastStepId) {
    lastStepId = step.id + u.index;
    $('#run-title').textContent = step.title;
    $('#run-instr').textContent = step.instruction;
    const ids = runner.steps.slice(0, u.index).map((s) => s.id);
    $$('#run-steps li').forEach((li) => {
      li.className = li.dataset.id === step.id ? 'now' : ids.includes(li.dataset.id) ? 'done' : '';
    });
    $('#run-pause').textContent = 'Pause';
    const m = session?.manual && /^dh-(right|left)-(hang|sit)$/.exec(step.id);
    $('#nys').hidden = !m;
    nys = m ? { side: m[1], phase: m[2] } : null;
    if (nys) {
      $('#nys-side').textContent = `${cap(nys.side)} · ${nys.phase === 'hang' ? 'head hanging' : 'sitting up'}`;
      $('[data-nys="reversal"]').hidden = nys.phase !== 'sit';
      renderNys();
    }
  }
  if (nys) Object.assign(nys, { reached: u.reached, reachedAt: u.reachedAt });
  $('#run-progress').textContent = `Step ${u.index + 1} of ${u.total}`;
  $('#run-rate').textContent = `${Math.round(u.rate)}°/s`;
  $('#run-rec').hidden = u.rec == null;
  if (u.rec != null) $('#run-rec-t').textContent = fmtTime(u.rec);

  const dial = $('.dial');
  const cue = $('#run-cue');
  let frac = 0;
  if (step.type === 'calibrate') {
    frac = u.still / step.hold;
    $('#dial-main').textContent = Math.round(u.rate);
    $('#dial-sub').textContent = '°/s · hold still';
    cue.textContent = u.message || (u.rate < 10 ? 'Hold still…' : 'Keep the head still, looking straight ahead');
    cue.className = 'cue ' + (u.message ? 'warn' : '');
    dial.classList.toggle('in', u.rate < 10);
  } else if (step.type === 'rest') {
    frac = u.held / step.hold;
    $('#dial-main').textContent = Math.ceil(step.hold - u.held);
    $('#dial-sub').textContent = 's rest';
    cue.textContent = 'Resting';
    cue.className = 'cue';
    dial.classList.remove('in');
  } else {
    frac = u.held / step.hold;
    const tol = settings.tolerance;
    if (u.reached) {
      $('#dial-main').textContent = Math.ceil(Math.max(0, step.hold - u.held));
      $('#dial-sub').textContent = `s left · ${Math.round(u.ev.error)}° off`;
    } else {
      $('#dial-main').textContent = Math.round(u.ev.error) + '°';
      $('#dial-sub').textContent = 'from target';
    }
    dial.classList.toggle('in', u.inTol);
    const c = cues(u.ev, Math.max(4, tol / 2));
    if (u.inTol) {
      cue.textContent = step.strict ? 'On target · hold' : 'On target · observe the eyes';
      cue.className = 'cue ok';
    } else {
      cue.textContent = c.length ? c.map((x) => x.text).slice(0, 2).join(' · ') : 'Almost there';
      cue.className = 'cue warn';
    }
    for (const bar of $$('#bars .bar')) {
      const k = bar.dataset.k;
      const v = u.ev[k];
      const pct = (x) => 50 + (Math.max(-60, Math.min(60, x)) / 60) * 50;
      // Needle shows where the head is relative to the target (target at the centre).
      bar.querySelector('.needle').style.left = pct(-v) + '%';
      const z = bar.querySelector('.zone');
      z.style.left = pct(-tol) + '%';
      z.style.width = pct(tol) - pct(-tol) + '%';
      bar.querySelector('em').textContent =
        Math.abs(v) < 3 ? 'ok' : `${SHORT[k](v)} ${Math.round(Math.abs(v))}°`;
    }
  }
  $('#dial-fill').style.strokeDashoffset = DIAL_LEN * (1 - Math.min(1, frac));
  $('#bars').style.visibility = step.type === 'pose' ? 'visible' : 'hidden';
  if (!$('#screen-run').classList.contains('light')) {
    drawHead($('#headviz'), u.head, step.type === 'pose' ? step.target : null, u.inTol);
  }
}

// Manual nystagmus entry during the Dix-Hallpike observation.
let nys = null;
const nysOnset = {};
const PATTERN_LABEL = {
  'upbeat-torsional': 'upbeat torsional', downbeat: 'downbeat', 'horizontal-geo': 'horizontal geotropic',
  'horizontal-apo': 'horizontal apogeotropic', other: 'other', none: 'none',
};
function renderNys() {
  const f = session.findings[nys.side] || {};
  $$('#nys-pattern button').forEach((b) => b.classList.toggle('on', b.dataset.pat === f.pattern));
  $('[data-nys="onset"]').classList.toggle('on', f.latency != null);
  $('[data-nys="end"]').classList.toggle('on', f.duration != null);
  $('[data-nys="reversal"]').classList.toggle('on', !!f.reversal);
  const bits = [];
  if (f.pattern) bits.push(PATTERN_LABEL[f.pattern]);
  if (f.latency != null) bits.push(`latency ${f.latency} s`);
  if (f.duration != null) bits.push(`duration ${f.duration} s`);
  if (f.reversal) bits.push('reversal');
  if (f.latency != null && !f.pattern) bits.push('pick the pattern');
  $('#nys-log').textContent = bits.length ? bits.join(' · ') : 'Tap Onset when nystagmus starts and End when it stops.';
}
$('#nys').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !nys) return;
  const f = (session.findings[nys.side] ||= {});
  const now = performance.now();
  const act = b.dataset.nys;
  if (act === 'onset') {
    nysOnset[nys.side] = now;
    f.latency = nys.reached ? +((now - nys.reachedAt) / 1000).toFixed(1) : 0;
    f.duration = null;
    if (f.pattern === 'none') f.pattern = '';
    recorder.mark?.('Nystagmus onset');
  } else if (act === 'end') {
    if (nysOnset[nys.side] == null) return toast('Tap Onset first.');
    f.duration = +((now - nysOnset[nys.side]) / 1000).toFixed(1);
  } else if (act === 'reversal') {
    f.reversal = !f.reversal;
  } else if (b.dataset.pat) {
    f.pattern = b.dataset.pat;
    if (f.pattern === 'none') {
      f.latency = f.duration = null;
      delete nysOnset[nys.side];
    }
  }
  beeper.tone(1200, 0.05, 0.1);
  renderNys();
});

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// Demo controls: simulated head = snapped target * small offsets.
let demoBase = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function applyDemo() {
  const t = +$('#demo-turn').value, c = +$('#demo-chin').value, l = +$('#demo-tilt').value;
  tracker.demoHead = mul(mul(mul(demoBase, rotZ(t)), rotX(c)), rotY(l));
}
$$('#demo input').forEach((i) => i.addEventListener('input', applyDemo));
$('#demo-snap').addEventListener('click', () => {
  const st = runner?.step;
  demoBase = st?.target || [1, 0, 0, 0, 1, 0, 0, 0, 1];
  $$('#demo input').forEach((i) => (i.value = 0));
  applyDemo();
});

async function saveRecording(v) {
  const side = session.sides.find((s) => v.label.toLowerCase().includes(s)) || session.sides[0];
  const rec = {
    id: store.uid(),
    sessionId: session.id,
    side,
    label: v.label,
    blob: v.blob,
    mime: v.mime,
    markers: v.markers,
    duration: v.duration,
    created: Date.now(),
  };
  try {
    await store.saveVideo(rec);
    session.videoIds.push(rec.id);
    await store.saveSession(session);
  } catch (e) {
    toast('Could not store video: ' + e.message);
  }
}

async function finishProcedure({ aborted, log }) {
  session.log = log;
  session.aborted = aborted;
  await store.saveSession(session).catch(() => {});
  releaseWakeLock();
  recorder.close();
  setLight(false);
  runner = null;
  lastStepId = null;
  if (settings.demo) tracker.demoHead = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (aborted) toast('Stopped. Partial session saved.');
  openSession(session.id);
}

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch { /* unsupported */ }
}
function releaseWakeLock() {
  wakeLock?.release?.();
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && runner && !runner.finished) requestWakeLock();
});

// ---------- review ----------
async function openSession(id) {
  const s = await store.getSession(id);
  if (!s) return toast('Session not found.');
  session = s;
  const videos = [];
  for (const vid of s.videoIds || []) {
    const v = await store.getVideo(vid).catch(() => null);
    if (v) videos.push(v);
  }
  if (s.type === 'dh') renderFindings(s, videos);
  else renderSummary(s, videos);
}

function metaLine(s) {
  const d = new Date(s.created);
  return [
    d.toLocaleString(),
    s.patient ? `Patient ${esc(s.patient)}` : null,
    s.entryOnly ? 'Manual entry' : s.mount === 'goggle' ? 'Headset mount' : 'Forehead mount',
    s.manual && !s.entryOnly ? 'Nystagmus entered manually' : null,
    s.aborted ? '<b>Stopped early</b>' : null,
  ].filter(Boolean).join(' · ');
}

function esc(x) {
  return String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function buildPlayer(v, onTime) {
  const el = $('#tpl-player').content.firstElementChild.cloneNode(true);
  const video = $('video', el);
  const url = URL.createObjectURL(v.blob);
  fixDuration(video);
  video.src = url;
  video.controls = true;
  const dl = $('[data-download]', el);
  dl.href = url;
  dl.download = `bppv_${new Date(v.created).toISOString().slice(0, 16).replace(/[:T]/g, '-')}_${v.label.replace(/\W+/g, '-')}.${extForMime(v.mime)}`;
  $('.markers', el).innerHTML = v.markers
    .map((m) => `<button data-t="${m.t}">${fmtTime(m.t)} · ${esc(m.label)}</button>`)
    .join('');
  let zoom = 1, rot = 0;
  const apply = () => (video.style.transform = `rotate(${rot}deg) scale(${zoom})`);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.t) {
      video.currentTime = +b.dataset.t;
      video.pause();
    } else if (b.dataset.rate) {
      video.playbackRate = +b.dataset.rate;
      video.play();
    } else if (b.dataset.step) {
      video.pause();
      video.currentTime = Math.max(0, video.currentTime + (+b.dataset.step) / 30);
    } else if (b.hasAttribute('data-zoom')) {
      zoom = zoom >= 3 ? 1 : zoom + 1;
      apply();
    } else if (b.hasAttribute('data-rotate')) {
      rot = (rot + 90) % 360;
      apply();
    }
  });
  onTime?.(video);
  return el;
}

const PATTERNS = [
  ['', '— select —'],
  ['none', 'No nystagmus'],
  ['upbeat-torsional', 'Upbeating torsional (geotropic)'],
  ['downbeat', 'Downbeating'],
  ['horizontal-geo', 'Horizontal geotropic'],
  ['horizontal-apo', 'Horizontal apogeotropic'],
  ['other', 'Other / atypical'],
];

function renderFindings(s, videos) {
  $('#findings-head').innerHTML = metaLine(s);
  if (s.entryOnly) {
    $('#findings-head').insertAdjacentHTML('beforeend',
      `<label class="field" style="margin-top:10px"><span>Patient ID (optional)</span><input id="findings-patient" autocomplete="off" value="${esc(s.patient || '')}"></label>`);
    $('#findings-patient').addEventListener('input', (e) => {
      s.patient = e.target.value.trim();
      persistFindings();
    });
  }
  const wrap = $('#findings-sides');
  wrap.innerHTML = '';
  for (const side of s.sides) {
    const f = (s.findings[side] ||= {});
    const card = document.createElement('div');
    card.className = 'panel side-card';
    const hang = s.log.find((l) => l.id === `dh-${side}-hang`);
    card.innerHTML = `
      <h3>${cap(side)} Dix-Hallpike</h3>
      <p class="hint">${hang?.reachedAfter != null
        ? `Head-hanging position reached ${hang.reachedAfter}s after the step began · peak speed ${hang.peakRate}°/s · on target ${hang.inTolPct}% of observation`
        : s.entryOnly ? 'Findings entered without guided positioning.' : 'Position not recorded'}</p>`;
    const v = videos.find((x) => x.side === side);
    let video = null;
    if (v) {
      card.append(buildPlayer(v, (el) => (video = el)));
      const mk = document.createElement('div');
      mk.className = 'row';
      mk.innerHTML = `<button class="btn small" data-mark="onset">Mark onset here</button><button class="btn small" data-mark="end">Mark end here</button>`;
      mk.addEventListener('click', (e) => {
        const b = e.target.closest('[data-mark]');
        if (!b || !video) return;
        const t = video.currentTime;
        const reached = v.markers.find((m) => /reached/i.test(m.label))?.t ?? 0;
        if (b.dataset.mark === 'onset') {
          f.onsetT = t;
          f.latency = +(t - reached).toFixed(1);
        } else {
          f.endT = t;
        }
        if (f.onsetT != null && f.endT != null) f.duration = +(f.endT - f.onsetT).toFixed(1);
        syncForm();
        persistFindings();
      });
      card.append(mk);
    } else {
      card.insertAdjacentHTML('beforeend', `<p class="hint">${s.manual ? 'No video: findings entered by the examiner.' : 'No eye video for this side.'}</p>`);
    }
    const form = document.createElement('div');
    form.className = 'form-grid';
    form.innerHTML = `
      <label>Nystagmus<select name="pattern">${PATTERNS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label>Latency (s)<input type="number" name="latency" step="0.1" min="0"></label>
      <label>Duration (s)<input type="number" name="duration" step="0.1" min="0"></label>
      <label class="check"><input type="checkbox" name="vertigo"> Vertigo reported</label>
      <label class="check"><input type="checkbox" name="reversal"> Reversal on sitting up</label>
      <label class="check"><input type="checkbox" name="fatigue"> Fatigues on repetition</label>`;
    card.append(form);
    const interp = document.createElement('div');
    card.append(interp);
    const syncForm = () => {
      for (const inp of $$('[name]', form)) {
        if (inp.type === 'checkbox') inp.checked = !!f[inp.name];
        else inp.value = f[inp.name] ?? '';
      }
      renderInterp();
    };
    const renderInterp = () => {
      const r = interpret(f, side);
      interp.innerHTML = r.text
        ? `<div class="interp ${r.level}">${esc(r.text)}</div>${r.treat ? `<button class="btn primary" data-epley="${r.treat}">Start Epley · ${cap(r.treat)}</button>` : ''}`
        : '';
      renderFindingsSummary(s);
    };
    form.addEventListener('input', (e) => {
      const t = e.target;
      f[t.name] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.value === '' ? null : +t.value) : t.value;
      renderInterp();
      persistFindings();
    });
    interp.addEventListener('click', (e) => {
      const b = e.target.closest('[data-epley]');
      if (!b) return;
      setup = { proc: 'epley', side: b.dataset.epley };
      if (s.patient) $('#patient').value = s.patient;
      go('setup');
    });
    syncForm();
    wrap.append(card);
  }
  renderFindingsSummary(s);
  go('findings');
}

let persistT;
function persistFindings() {
  clearTimeout(persistT);
  persistT = setTimeout(() => store.saveSession(session).catch(() => {}), 400);
}

function findingsText(s) {
  const lines = [`Dix-Hallpike — ${new Date(s.created).toLocaleString()}${s.patient ? ` — Patient ${s.patient}` : ''}`];
  for (const side of s.sides) {
    const f = s.findings[side] || {};
    const pat = PATTERNS.find(([k]) => k === f.pattern)?.[1] || 'not recorded';
    const bits = [pat];
    if (f.latency != null) bits.push(`latency ${f.latency}s`);
    if (f.duration != null) bits.push(`duration ${f.duration}s`);
    if (f.vertigo) bits.push('vertigo');
    if (f.reversal) bits.push('reversal on sitting');
    if (f.fatigue) bits.push('fatigable');
    lines.push(`${cap(side)}: ${bits.join(', ')}`);
    const r = interpret(f, side);
    if (r.text) lines.push('  → ' + r.text);
  }
  return lines.join('\n');
}

function renderFindingsSummary(s) {
  $('#findings-summary').innerHTML = `<h3>Summary</h3><pre style="white-space:pre-wrap;margin:0;font:inherit">${esc(findingsText(s))}</pre>`;
}

$('#findings-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(findingsText(session));
    toast('Summary copied.');
  } catch {
    toast('Copy failed.');
  }
});

function renderSummary(s, videos) {
  $('#summary-head').innerHTML = `${cap(s.sides[0])} ear Epley · ${metaLine(s)}`;
  const vw = $('#summary-videos');
  vw.innerHTML = '';
  for (const v of videos) vw.append(buildPlayer(v));
  $('#summary-log').innerHTML =
    '<tr><th>Position</th><th class="num">Reached (s)</th><th class="num">Held (s)</th><th class="num">Mean error</th><th class="num">On target</th></tr>' +
    s.log
      .filter((l) => l.type === 'pose')
      .map((l) => `<tr><td>${esc(l.title)}${l.skipped ? ' <small>(skipped)</small>' : ''}</td>
        <td class="num">${l.reachedAfter ?? '—'}</td><td class="num">${l.held}</td>
        <td class="num">${l.meanError != null ? l.meanError + '°' : '—'}</td>
        <td class="num">${l.inTolPct != null ? l.inTolPct + '%' : '—'}</td></tr>`)
      .join('');
  go('summary');
}

$('#summary-repeat').addEventListener('click', () => {
  setup = { proc: 'epley', side: session.sides[0] };
  go('setup');
});
$('#summary-retest').addEventListener('click', () => {
  setup = { proc: 'dh', side: session.sides[0] };
  go('setup');
});

$('#manual-findings').addEventListener('click', async () => {
  session = {
    id: store.uid(),
    type: 'dh',
    created: Date.now(),
    patient: '',
    sides: ['right', 'left'],
    mount: null,
    manual: true,
    entryOnly: true,
    videoIds: [],
    findings: {},
    log: [],
  };
  try {
    await store.saveSession(session);
  } catch { /* stays in memory */ }
  renderFindings(session, []);
});

// ---------- sessions ----------
async function renderSessions() {
  let list = [];
  try {
    list = await store.listSessions();
  } catch { /* IndexedDB unavailable */ }
  $('#sessions-empty').hidden = list.length > 0;
  $('#sessions-list').innerHTML = list
    .map((s) => {
      const what = s.type === 'dh' ? `Dix-Hallpike · ${s.sides.map(cap).join(' + ')}` : `Epley · ${cap(s.sides[0])} ear`;
      const res = s.type === 'dh'
        ? s.sides.map((sd) => interpret(s.findings?.[sd] || {}, sd)).filter((r) => r.level !== 'none').map((r) => r.level === 'pos' ? 'positive' : r.level === 'neg' ? 'neg' : 'see notes').join(', ')
        : `${s.log.filter((l) => l.type === 'pose' && !l.skipped).length}/6 positions`;
      return `<li><button class="open" data-open="${s.id}">${what}${s.aborted ? ' (stopped)' : ''}
        <small>${new Date(s.created).toLocaleString()}${s.patient ? ' · ' + esc(s.patient) : ''} · ${(s.videoIds || []).length} video · ${esc(res || '')}</small></button>
        <button class="btn small danger" data-del="${s.id}" aria-label="Delete session">Delete</button></li>`;
    })
    .join('');
}
$('#sessions-list').addEventListener('click', async (e) => {
  const o = e.target.closest('[data-open]');
  const d = e.target.closest('[data-del]');
  if (o) openSession(o.dataset.open);
  if (d && confirm('Delete this session and its videos?')) {
    await store.deleteSession(d.dataset.del);
    renderSessions();
  }
});

// ---------- settings ----------
function renderSettings() {
  const form = $('#settings-form');
  for (const inp of $$('[name]', form)) {
    if (inp.type === 'checkbox') inp.checked = !!settings[inp.name];
    else inp.value = settings[inp.name];
  }
}
$('#settings-form').addEventListener('input', (e) => {
  const t = e.target;
  if (t.type === 'checkbox') settings[t.name] = t.checked;
  else if (t.value !== '' && Number.isFinite(+t.value)) settings[t.name] = +t.value;
  if (t.name === 'demo') tracker.demoHead = t.checked ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : null;
  saveSettings();
});
$('#settings-reset').addEventListener('click', () => {
  settings = { ...DEFAULTS, mount: settings.mount };
  tracker.demoHead = null;
  saveSettings();
  renderSettings();
  toast('Defaults restored.');
});

// ---------- boot ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (!window.isSecureContext) toast('Open over HTTPS: sensors and camera need a secure page.', 6000);
go('home', { push: false });
