// Front-camera eye recording with timestamped markers.

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export class EyeRecorder {
  constructor(videoEl) {
    this.videoEl = videoEl;
    this.stream = null;
    this.rec = null;
    this.chunks = [];
    this.markers = [];
    this.t0 = 0;
    this.label = '';
  }

  get supported() {
    return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  }

  get recording() {
    return this.rec?.state === 'recording';
  }

  async open({ fps = 60 } = {}) {
    if (this.stream) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: fps },
      },
    });
    // Keep a playing element attached so mobile browsers keep the camera running.
    this.videoEl.srcObject = this.stream;
    await this.videoEl.play().catch(() => {});
    return this.stream;
  }

  close() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.videoEl.srcObject = null;
  }

  settings() {
    return this.stream?.getVideoTracks()[0]?.getSettings() || {};
  }

  start(label) {
    if (!this.stream || this.recording) return false;
    const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : {});
    this.chunks = [];
    this.markers = [];
    this.label = label;
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
    this.t0 = performance.now();
    this.mark('Recording started');
    return true;
  }

  elapsed() {
    return this.recording ? (performance.now() - this.t0) / 1000 : 0;
  }

  mark(label) {
    if (!this.recording) return null;
    const m = { t: +this.elapsed().toFixed(2), label };
    this.markers.push(m);
    return m;
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.recording) return resolve(null);
      const duration = this.elapsed();
      this.rec.onstop = () => {
        const type = this.rec.mimeType || this.chunks[0]?.type || 'video/webm';
        resolve({
          blob: new Blob(this.chunks, { type }),
          mime: type,
          label: this.label,
          markers: this.markers,
          duration,
        });
      };
      this.rec.stop();
    });
  }
}

export const extForMime = (mime) => (mime.includes('mp4') ? 'mp4' : 'webm');

// MediaRecorder WebM files have no duration header; force the browser to scan it
// so seeking and marker jumps work.
export function fixDuration(video) {
  video.addEventListener('loadedmetadata', function onMeta() {
    video.removeEventListener('loadedmetadata', onMeta);
    if (video.duration !== Infinity) return;
    video.currentTime = 1e7;
    video.addEventListener('timeupdate', function reset() {
      video.removeEventListener('timeupdate', reset);
      video.currentTime = 0;
    });
  });
}
