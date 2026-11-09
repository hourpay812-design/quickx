/**
 * Client for the QuickX backend.
 */
export class QuickXClient {
  constructor(baseUrl = '') {
    // Relative URL so it automatically uses window.location origin (works under same-port serving)
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
    this.differenceFrames = [];
    this.mode = 'blink';
    this.currentIdx = 0;
    this.isPlaying = false;
    this.intervalId = null;
    this.speed = 400;
    this.onFrame = null;
  }

  setFrames(frames, differenceFrames = []) {
    // Lazy decode: PNG bytes stay hex until a frame is first drawn.
    this.frames = frames.map(f => ({ ...f, img: null }));
    this.differenceFrames = differenceFrames.map(df => ({ ...df, img: null }));
    this.currentIdx = 0;
    this.drawCurrent();
  }

  imgFor(item) {
    if (!item.img) {
      const bytes = new Uint8Array(item.png_b64.match(/.{1,2}/g).map(b => parseInt(b, 16)));
      const blob = new Blob([bytes], { type: 'image/png' });
      item.img = new Image();
      item.img.src = URL.createObjectURL(blob);
    }
    return item.img;
  }

  activeList() {
    return (this.mode === 'difference' && this.differenceFrames.length > 0)
      ? this.differenceFrames
      : this.frames;
  }

  setMode(mode) {
    this.stop();
    this.mode = mode;
    this.currentIdx = 0;
    this.drawCurrent();
  }

  drawCurrent() {
    const list = this.activeList();
    if (!list.length) return;
    const item = list[Math.min(this.currentIdx, list.length - 1)];
    const img = this.imgFor(item);

    if (!img.complete) {
      img.onload = () => this.drawCurrent();
      return;
    }

    this.canvas.width = img.naturalWidth;
    this.canvas.height = img.naturalHeight;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(img, 0, 0);
    this.drawOverlay(item);

    const bObs = document.getElementById('badge-obsid');
    const bDate = document.getElementById('badge-date');
    const bWave = document.getElementById('badge-wave');
    if (bObs) bObs.textContent = item.obs_id || (item.pair ? item.pair.join(' − ') : '');
    if (bDate) bDate.textContent = item.date_obs ? new Date(item.date_obs).toLocaleDateString() : '';
    if (bWave) bWave.textContent = `${item.wavelength_um} µm`;

    this.canvas.setAttribute('aria-label',
      `Frame ${item.obs_id || (item.pair || []).join(' vs ')}, ${item.wavelength_um} micrometres` +
      (item.color ? ', false colour' : ', grayscale'));

    document.querySelectorAll('.epoch-item').forEach((el, i) => {
      el.classList.toggle('epoch-active', i === this.currentIdx);
    });
    if (this.onFrame) this.onFrame(item, this.currentIdx);
  }

  drawOverlay(item) {
    // MOST ephemeris prediction, projected server-side into FITS pixel space.
    if (!item.overlay || this.mode === 'difference') return;
    const x = item.overlay.x;
    const y = this.canvas.height - 1 - item.overlay.y; // PNG is flipped vs FITS
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.moveTo(x - 7, y); ctx.lineTo(x - 3, y);
    ctx.moveTo(x + 3, y); ctx.lineTo(x + 7, y);
    ctx.moveTo(x, y - 7); ctx.lineTo(x, y - 3);
    ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 7);
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.font = '6px sans-serif';
    ctx.fillText('predicted', x + 6, y - 6);
    ctx.restore();
  }

  start() {
    const list = this.activeList();
    if (this.isPlaying || list.length < 2) return;
    this.isPlaying = true;
    // Flicker is rapid alternation to fuse epochs perceptually; blink uses user speed.
    const interval = this.mode === 'flicker' ? 120 : this.speed;
    this.intervalId = setInterval(() => {
      this.currentIdx = (this.currentIdx + 1) % list.length;
      this.drawCurrent();
    }, interval);
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

  step(delta) {
    const list = this.activeList();
    if (!list.length) return;
    this.stop();
    this.currentIdx = (this.currentIdx + delta + list.length) % list.length;
    this.drawCurrent();
  }
}