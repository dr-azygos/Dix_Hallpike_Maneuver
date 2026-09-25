# BPPV Assistant

A phone web app for posterior canal BPPV. The phone is strapped to the patient's head. The app:

1. **Guides the Dix-Hallpike test** with voice and beeps, and **films the eyes** with the front camera from the moment the patient lies back until they sit up again.
2. **Lets you review the nystagmus** at ¼× or ½× speed, frame by frame, zoomed and rotated. You tap *Onset* and *End* to measure latency and duration, then record the pattern. The app suggests the likely canal and the side to treat.
3. **Guides the Epley manoeuvre** position by position. The phone's gyroscope-based orientation compares the head with each target pose. The hold timer runs only while the head is within tolerance.

No install and no build step. It is a static Progressive Web App: open it over HTTPS, add it to the home screen, and it works offline. Sessions and videos are stored on the phone only (IndexedDB).

## Mounting

| Mount | Screen | Video | How you're guided |
|---|---|---|---|
| **Headset** (recommended) | faces the eyes, in a VR/Cardboard-style headset | front camera films both eyes | voice and proximity beeps; the screen shows a uniform light with no fixation target (Frenzel-like) |
| **Forehead** | faces you | none | on-screen angle display, voice and beeps |

## Workflow

1. **Setup**: patient ID (optional), side, mount, safety screen, sensor check, camera framing check.
2. **Calibrate**: patient seated on the couch facing its foot end, head straight. Calibration is automatic after 2.5 s of stillness.
3. **Dix-Hallpike** (right, left, or both with a rest and recalibration in between):
   turn 45° → lie back briskly with the head hanging 20° (records; time-to-position and peak angular speed are logged) → observe 45 s → sit up, observe 20 s.
4. **Findings**: video review with markers, pattern / latency / duration / reversal / fatigue. The interpretation offers **Start Epley** for the positive side.
   **No camera?** Choose *Nystagmus → Enter manually* in setup (automatic with the forehead mount). During the observation, tap **Onset** and **End** and pick the pattern; latency and duration are calculated. Tap **Reversal seen** after sitting up. **Enter findings only** on the home screen records a test done without the app's guidance.
5. **Epley**: turn 45° → head hanging → turn 90° to the other side → roll onto the side, nose 45° down → sit up → head central, chin down. The summary shows time to reach, hold, mean error and % on target for each position.

Cues are phrased relative to the patient's body: *Rotate* left/right, *Chin* up/down, *Tilt* toward a shoulder. A proximity beep speeds up as the head nears the target; a chime means the head is on target.

## Geometry

- World frame fixed at calibration: X = patient's right, Y = toward the foot of the couch, Z = up.
- Each target is `body × neck`. For example, right Epley position 2 is `rotX(90 + 20) · rotZ(−45)`: supine plus 20° hanging, head turned 45° right.
- The error is the rotation still needed (`R_currentᵀ · R_target`). It is converted to the target's body frame, so extension shows as "chin up" even when the head is turned.
- Seated steps after rolling ignore rotation about the vertical, because body heading is arbitrary there.

All defaults (tolerance 15°, extension 20°, holds, observation times, light level, camera fps) are adjustable in **Settings**.

## Running

```bash
npm test            # geometry, protocol and tracker unit tests (Node 18+, no dependencies)
npm run serve       # http://localhost:8080 (localhost counts as a secure context)
```

For a phone, serve over HTTPS. The included workflow tests and deploys to **GitHub Pages** on pushes to `main` (set *Settings → Pages → Source* to *GitHub Actions*).

**Demo mode** (Settings) simulates the head with sliders and a *Snap to target* button, so the whole flow can be tried on a desk or computer.

## Limitations

- Orientation comes from the OS sensor fusion (`deviceorientation`), and angular speed from the raw gyroscope (`devicemotion`). Expect a few degrees of error and slow drift about the vertical; recalibrate in long sessions.
- The screen's light is the only illumination. Use a dim room and a headset that blocks ambient light. Torsion is easier to see at ½× speed.
- iOS asks for motion permission on first start. Recording format is MP4 on Safari and WebM on Chrome.
- A clinical aid for trained examiners, not a diagnostic device. Screen for contraindications to neck extension and rotation before positioning.
