/**
 * Client for the QuickX backend.
 */
export class QuickXClient {
  constructor(baseUrl = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
  }

  async fetch(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const resp = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.detail || `HTTP ${resp.status}`);
    }
    return resp.json();
  }

  async resolve(name) {
    return this.fetch('/api/resolve', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async search(ra, dec, detector = null) {
    return this.fetch('/api/search', {
      method: 'POST',
      body: JSON.stringify({ ra, dec, detector }),
    });
  }

  async createJob(params) {
    return this.fetch('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async getJob(jobId) {
    return this.fetch(`/api/jobs/${jobId}`);
  }

  async getMovingObject(name) {
    return this.fetch('/api/moving-object', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }
}

/**
 * Image processing and canvas rendering.
 */
export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.frames = [];
    this.currentIdx = 0;
    this.isPlaying = false;
    this.intervalId = null;
    this.speed = 400;
  }

  setFrames(frames) {
    this.frames = frames.map(f => ({
      ...f,
      img: this.decodePng(f.png_b64)
    }));
    this.currentIdx = 0;
    this.drawCurrent();
  }

  decodePng(hex) {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const blob = new Blob([bytes], { type: 'image/png' });
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    return img;
  }

  drawCurrent() {
    if (!this.frames.length) return;
    const frame = this.frames[this.currentIdx];
    const img = frame.img;

    if (!img.complete) {
      img.onload = () => this.drawCurrent();
      return;
    }

    this.canvas.width = img.naturalWidth;
    this.canvas.height = img.naturalHeight;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(img, 0, 0);

    // Update metadata badge
    document.getElementById('badge-obsid').textContent = frame.obs_id;
    document.getElementById('badge-date').textContent = new Date(frame.date_obs).toLocaleDateString();
    document.getElementById('badge-wave').textContent = `${frame.wavelength_um} µm`;

    // Highlight current in list
    document.querySelectorAll('.epoch-item').forEach((el, i) => {
      el.classList.toggle('border-cyan-500', i === this.currentIdx);
      el.classList.toggle('bg-cyan-500/10', i === this.currentIdx);
    });
  }

  start() {
    if (this.isPlaying || this.frames.length < 2) return;
    this.isPlaying = true;
    this.intervalId = setInterval(() => {
      this.currentIdx = (this.currentIdx + 1) % this.frames.length;
      this.drawCurrent();
    }, this.speed);
  }

  stop() {
    this.isPlaying = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  setSpeed(ms) {
    this.speed = ms;
    if (this.isPlaying) {
      this.stop();
      this.start();
    }
  }
}
