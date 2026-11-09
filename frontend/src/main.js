import { QuickXClient, Viewer } from './app.js';
import { renderSpectrum } from './viz.js';

const client = new QuickXClient();
const viewer = new Viewer(document.getElementById('blink-canvas'));
const $ = (id) => document.getElementById(id);

const statusBar = $('status-bar');
const objSearch = $('obj-search');
const playBtn = $('play-btn');
const colorBtn = $('color-btn');
const expertBtn = $('expert-btn');
const lowDataBtn = $('low-data-btn');
const movingBtn = $('moving-btn');
const sidebarBtn = $('sidebar-btn');
const speedSelect = $('speed-select');
const stretchSelect = $('stretch-select');
const timelineSlider = $('timeline-slider');

const state = {
    jobId: null,
    pollGen: 0,
    frames: [],
    spectrum: [],
    lastTarget: null,
    targetName: null,
    color: false,
    stretch: 'asinh',
    speed: 400,
    expert: false,
    lowData: false,
    moving: null,
    movingData: null,
    pendingIdx: null,
    jobResolve: null,
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// --- URL state: every view is shareable -------------------------------------

function writeUrl() {
    const p = new URLSearchParams();
    const t = state.lastTarget;
    if (t) {
        if (t.name && !state.moving) p.set('name', t.name);
        else {
            p.set('ra', t.ra.toFixed(6));
            p.set('dec', t.dec.toFixed(6));
        }
    }
    if (viewer.mode !== 'blink') p.set('mode', viewer.mode);
    if (state.color) p.set('color', '1');
    if (state.stretch !== 'asinh') p.set('stretch', state.stretch);
    if (viewer.currentIdx > 0) p.set('idx', String(viewer.currentIdx));
    if (state.speed !== 400) p.set('speed', String(state.speed));
    if (state.expert) p.set('view', 'expert');
    if (state.lowData) p.set('data', 'low');
    if (state.moving) p.set('moving', state.moving);
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function readUrl() {
    const p = new URLSearchParams(location.search);
    if (p.get('view') === 'expert') setExpert(true);
    if (p.get('data') === 'low') setLowData(true, false);
    if (p.get('color') === '1') {
        state.color = true;
        colorBtn.setAttribute('aria-pressed', 'true');
    }
    const stretch = p.get('stretch');
    if (['asinh', 'log', 'linear'].includes(stretch)) {
        state.stretch = stretch;
        stretchSelect.value = stretch;
    }
    const speed = Number(p.get('speed'));
    if ([200, 400, 800, 1500].includes(speed)) {
        state.speed = speed;
        viewer.setSpeed(speed);
        speedSelect.value = String(speed);
    }
    const mode = p.get('mode');
    if (['blink', 'flicker', 'timeline', 'difference'].includes(mode)) setMode(mode);
    const idx = Number(p.get('idx'));
    if (Number.isInteger(idx) && idx >= 0) state.pendingIdx = idx;

    const moving = p.get('moving');
    const name = p.get('name');
    const ra = parseFloat(p.get('ra'));
    const dec = parseFloat(p.get('dec'));
    if (moving) state.moving = moving;
    if (name) objSearch.value = name;
    if (name && moving) {
        loadMoving(name)
            .then((data) => {
                const m = data.matches[0];
                if (m) {
                    state.targetName = null;
                    return startJob(m.ra_predicted, m.dec_predicted);
                }
                statusBar.textContent = `MOST found no SPHEREx coverage for ${name}`;
            })
            .catch((err) => { statusBar.textContent = `Error: ${err.message}`; });
    } else if (name) {
        search(name);
    } else if (Number.isFinite(ra) && Number.isFinite(dec) && ra >= 0 && ra <= 360 && dec >= -90 && dec <= 90) {
        if (moving) loadMoving(moving).catch(() => {});
        startJob(ra, dec);
    }
}

// --- Job lifecycle -----------------------------------------------------------

async function search(name) {
    statusBar.textContent = 'Resolving name via NED...';
    state.targetName = name;
    try {
        const obj = await client.resolve(name);
        state.targetName = obj.resolved_name || name;
        await startJob(obj.ra, obj.dec);
    } catch (err) {
        // NED rejects informal comet names; MOST knows them (service-findings §7)
        statusBar.textContent = 'NED failed; trying MOST moving-object match...';
        try {
            const data = await loadMoving(name);
            const m = data.matches[0];
            if (!m) throw new Error('no matches');
            state.targetName = null;
            await startJob(m.ra_predicted, m.dec_predicted);
        } catch {
            state.targetName = null;
            statusBar.textContent = `Error: ${err.message}`;
        }
    }
}

function startJob(ra, dec) {
    state.lastTarget = { ra, dec, name: state.targetName };
    statusBar.textContent = 'Creating job...';
    const gen = ++state.pollGen;
    const done = new Promise((res) => { state.jobResolve = res; });
    client.createJob({
        ra,
        dec,
        stretch: state.stretch,
        color: state.color,
        max_frames: state.lowData ? 4 : 12,
        moving_object: state.moving || undefined,
    }).then((job) => {
        if (gen !== state.pollGen) return;
        state.jobId = job.job_id;
        writeUrl();
        if (aladin) {
            try { aladin.gotoRaDec(ra, dec); } catch { /* map is best-effort */ }
        }
        pollJob(gen);
    }).catch((err) => {
        statusBar.textContent = `Error: ${err.message}`;
        state.jobResolve?.(null);
        state.jobResolve = null;
    });
    return done;
}

async function pollJob(gen) {
    if (gen !== state.pollGen || !state.jobId) return;
    try {
        const job = await client.getJob(state.jobId);
        if (gen !== state.pollGen) return;
        statusBar.textContent = `Job: ${job.status} (${job.progress}/${job.total})`;

        if (job.frames && job.frames.length > 0) {
            const firstFrames = state.frames.length === 0;
            state.frames = job.frames;
            state.spectrum = job.spectrum || [];
            renderEpochList(job.frames);
            renderSpectrum(state.spectrum);
            renderDetails(job);
            viewer.setFrames(job.frames, job.difference_frames || []);
            if (firstFrames && state.pendingIdx != null) {
                viewer.currentIdx = Math.min(state.pendingIdx, viewer.activeList().length - 1);
                state.pendingIdx = null;
                viewer.drawCurrent();
            }
            syncTimeline();
        }

        if (job.status === 'running' || job.status === 'pending') {
            // 2s cadence: 1s polling alone saturates the per-IP token bucket
            setTimeout(() => pollJob(gen), 2000);
        } else {
            statusBar.textContent = (job.status === 'failed' || job.error)
                ? (job.error || 'Job failed')
                : `Ready · ${job.frames.length} matched epochs`;
            writeUrl();
            state.jobResolve?.(job);
            state.jobResolve = null;
        }
    } catch (err) {
        if (gen !== state.pollGen) return;
        statusBar.textContent = `Polling error: ${err.message}`;
        // Transient failures (e.g. 429) must not strand the viewer mid-job
        if (err.message === 'Job not found') {
            state.jobResolve?.(null);
            state.jobResolve = null;
            return;
        }
        setTimeout(() => pollJob(gen), 2000);
    }
}

// --- Rendering ---------------------------------------------------------------

function renderEpochList(frames) {
    const list = $('obs-list');
    list.innerHTML = '';
    frames.forEach((f, i) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'epoch-item';
        el.innerHTML = `
            <span class="epoch-id">${esc(f.obs_id.split('_').slice(-2).join('_'))}</span>
            <span class="epoch-date">${esc(f.date_obs ? new Date(f.date_obs).toLocaleDateString() : '')}</span>
            <span class="epoch-wave">${esc(f.wavelength_um)} µm</span>
            <span class="epoch-det">Det ${esc(f.detector)}</span>`;
        el.onclick = () => {
            viewer.stop();
            syncPlayBtn();
            viewer.currentIdx = i;
            viewer.drawCurrent();
        };
        list.appendChild(el);
    });
}

function renderDetails(job) {
    const d = job.matching_diagnostic || {};
    $('frame-details').innerHTML = `
        <div class="detail-row"><span>Anchor wavelength</span><strong>${d.anchor_wavelength_um != null ? d.anchor_wavelength_um.toFixed(4) : '—'} µm</strong></div>
        <div class="detail-row"><span>Pixel bandwidth</span><strong>${d.reference_bandwidth_um != null ? d.reference_bandwidth_um.toFixed(4) : '—'} µm</strong></div>
        <div class="detail-row"><span>Matched epochs</span><strong>${d.matched_count ?? 0} / ${d.total_count ?? 0}</strong></div>
        <p class="detail-note">Epochs matched on per-pixel LVF wavelength (±1 bandwidth), never on band name.</p>
        <div id="frame-wcs" class="expert-only"></div>
        <p class="attribution">${esc(job.attribution || '')}</p>`;
    const item = viewer.activeList()[viewer.currentIdx];
    if (state.expert && item) renderFrameWcs(item);
}

function renderFrameWcs(item) {
    const el = $('frame-wcs');
    if (!el) return;
    const w = item.wcs || {};
    const rows = ['CRVAL1', 'CRVAL2', 'CD1_1', 'CD1_2', 'CD2_1', 'CD2_2']
        .filter((k) => k in w)
        .map((k) => `<div class="detail-row"><span>${k}</span><strong>${esc(Number(w[k]).toPrecision(8))}</strong></div>`)
        .join('');
    el.innerHTML = `<h4>Frame WCS</h4>${rows}` + (item.det_x != null
        ? `<div class="detail-row"><span>Detector pixel</span><strong>${esc(item.det_x)}, ${esc(item.det_y)}</strong></div>`
        : '');
}

function syncPlayBtn() {
    playBtn.textContent = viewer.isPlaying ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-pressed', String(viewer.isPlaying));
}

function syncTimeline() {
    const list = viewer.activeList();
    timelineSlider.max = String(Math.max(0, list.length - 1));
    timelineSlider.value = String(Math.max(0, Math.min(viewer.currentIdx, list.length - 1)));
    const item = list[viewer.currentIdx];
    if (!item) {
        $('timeline-label').textContent = '';
        return;
    }
    const when = item.date_obs
        ? new Date(item.date_obs).toLocaleDateString()
        : (item.mjd != null ? `MJD ${item.mjd.toFixed(2)}`
            : (item.mjd_pair ? `MJD ${item.mjd_pair[0].toFixed(2)}` : ''));
    $('timeline-label').textContent = `${when} · ${item.wavelength_um} µm`;
}

function setMode(mode) {
    viewer.setMode(mode);
    document.querySelectorAll('#mode-switcher .segmented-btn').forEach((b) => {
        const on = b.dataset.mode === mode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
    $('timeline-bar').hidden = mode !== 'timeline';
    syncPlayBtn();
    syncTimeline();
    writeUrl();
}

viewer.onFrame = (item) => {
    syncTimeline();
    const extra = $('badge-extra');
    if (item.color) {
        extra.textContent = 'False colour · wavelength tint';
        extra.className = 'badge-line false-color-note';
        extra.hidden = false;
    } else if (viewer.mode === 'difference') {
        extra.textContent = 'Difference · matched bands';
        extra.className = 'badge-line badge-muted';
        extra.hidden = false;
    } else {
        extra.hidden = true;
    }
    if (state.expert) renderFrameWcs(item);
    if (!viewer.isPlaying) writeUrl();
};

// --- Moving objects + tour ---------------------------------------------------

async function loadMoving(name) {
    statusBar.textContent = `Querying JPL + MOST for ${name}...`;
    const data = await client.getMovingObject(name);
    state.moving = name;
    state.movingData = data;
    movingBtn.setAttribute('aria-pressed', 'true');
    renderMovingPanel(data);
    return data;
}

function renderMovingPanel(data) {
    const panel = $('moving-panel');
    panel.hidden = false;
    const o = data.orbit || {};
    const facts = [
        ['Eccentricity', o.eccentricity != null ? o.eccentricity.toFixed(3) : '—'],
        ['Perihelion', o.perihelion_distance_au != null ? `${o.perihelion_distance_au.toFixed(3)} au` : '—'],
        ['Inclination', o.inclination_deg != null ? `${o.inclination_deg.toFixed(2)}°` : '—'],
        ['Orbit type', o.is_hyperbolic ? 'Hyperbolic (interstellar)' : 'Bound'],
    ].map(([k, v]) => `<div class="detail-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
    const rows = (data.matches || []).slice(0, 8).map((m) => `
        <tr>
            <td>${m.mjd != null ? m.mjd.toFixed(2) : '—'}</td>
            <td>${m.ra_predicted != null ? m.ra_predicted.toFixed(4) : '—'}, ${m.dec_predicted != null ? m.dec_predicted.toFixed(4) : '—'}</td>
            <td>${m.vmag != null ? m.vmag.toFixed(1) : '—'}</td>
        </tr>`).join('');
    panel.innerHTML = `
        <h4>${esc(data.object)} · predicted vs observed</h4>
        ${facts}
        <div class="detail-row"><span>MOST matched frames</span><strong>${data.match_count}</strong></div>
        ${rows ? `<table class="moving-table">
            <thead><tr><th>MJD</th><th>Predicted RA, Dec</th><th>V</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>` : ''}
        <p class="detail-note">Amber crosshairs on frames mark the MOST-predicted position; the source itself is the observed emission.</p>`;
}

movingBtn.onclick = async () => {
    if (state.moving) {
        state.moving = null;
        movingBtn.setAttribute('aria-pressed', 'false');
        $('moving-panel').hidden = true;
        writeUrl();
        if (state.lastTarget) await startJob(state.lastTarget.ra, state.lastTarget.dec);
        return;
    }
    const name = objSearch.value.trim();
    if (!name) {
        statusBar.textContent = 'Type a solar-system target first (e.g. 3I/ATLAS)';
        return;
    }
    try {
        const data = await loadMoving(name);
        if (!data.matches.length) {
            statusBar.textContent = `MOST found no SPHEREx coverage for ${name}`;
            return;
        }
        if (state.lastTarget) {
            await startJob(state.lastTarget.ra, state.lastTarget.dec);
        } else {
            const m = data.matches[0];
            state.targetName = null;
            await startJob(m.ra_predicted, m.dec_predicted);
        }
    } catch (err) {
        statusBar.textContent = `Error: ${err.message}`;
    }
};

const tourSteps = [
    {
        text: '3I/ATLAS is only the third known interstellar object. Fetching its real orbit from JPL and its SPHEREx coverage from MOST…',
        run: () => loadMoving('3I/ATLAS'),
    },
    {
        text: () => {
            const o = state.movingData?.orbit || {};
            return `JPL gives e = ${o.eccentricity != null ? o.eccentricity.toFixed(2) : '?'} — hyperbolic, so it came from outside the Solar System. MOST matched ${state.movingData?.match_count ?? 0} frames. Loading real cutouts at the predicted position (31–120 s each)…`;
        },
        run: async () => {
            const m = state.movingData?.matches?.[0];
            if (!m) throw new Error('No MOST matches to load');
            state.targetName = null;
            const job = await startJob(m.ra_predicted, m.dec_predicted);
            if (!job || job.status === 'failed' || !job.frames?.length) {
                throw new Error(job?.error || 'No frames fetched');
            }
        },
    },
    {
        text: 'Blink mode: the amber crosshair is the MOST-predicted position. Watch the comet shift against the fixed stars.',
        run: () => { setMode('blink'); viewer.start(); syncPlayBtn(); },
    },
    {
        text: 'Difference mode subtracts matched-band epochs, so the moving source stands out as a bright/dark pair.',
        run: () => setMode('difference'),
    },
    {
        text: 'The inspector plots its spectrum across the matched bands. Tour complete — the sky is yours.',
        run: () => setMode('blink'),
    },
];

let tourIdx = -1;

async function tourNext() {
    tourIdx += 1;
    if (tourIdx >= tourSteps.length) {
        exitTour();
        return;
    }
    const step = tourSteps[tourIdx];
    $('tour-banner').hidden = false;
    $('tour-text').textContent = typeof step.text === 'function' ? step.text() : step.text;
    $('tour-next-btn').disabled = true;
    try {
        await step.run();
    } catch (err) {
        $('tour-text').textContent = `Tour step failed: ${err.message}`;
    }
    $('tour-next-btn').disabled = false;
    $('tour-next-btn').textContent = tourIdx === tourSteps.length - 1 ? 'Finish' : 'Next';
}

function exitTour() {
    tourIdx = -1;
    $('tour-banner').hidden = true;
    viewer.stop();
    syncPlayBtn();
}

$('tour-btn').onclick = () => { tourIdx = -1; tourNext(); };
$('tour-next-btn').onclick = tourNext;
$('tour-exit-btn').onclick = exitTour;

// --- Aladin Lite sky map (graceful fallback: CDS may be unreachable) -----------

const ALADIN_URL = 'https://aladin.u-strasbg.fr/AladinLite/api/v3/latest/aladin.js';
let aladin = null;
let mapState = 'idle';

function initMap() {
    if (aladin || mapState === 'loading') return;
    mapState = 'loading';
    const fail = () => {
        mapState = 'failed';
        $('aladin-lite').hidden = true;
        $('map-fallback').hidden = false;
    };
    const create = () => {
        try {
            aladin = window.A.aladin('#aladin-lite', {
                survey: 'P/2MASS/color',
                fov: 0.3,
                target: 'M51',
                showReticle: true,
            });
            aladin.on('click', () => {
                const [ra, dec] = aladin.getRaDec();
                state.targetName = null;
                objSearch.value = '';
                startJob(ra, dec);
            });
            mapState = 'ready';
        } catch {
            fail();
        }
    };
    if (window.A) {
        create();
        return;
    }
    const timer = setTimeout(() => { if (mapState === 'loading') fail(); }, 10000);
    const s = document.createElement('script');
    s.src = ALADIN_URL;
    s.onload = () => {
        clearTimeout(timer);
        if (mapState === 'loading') create();
    };
    s.onerror = () => {
        clearTimeout(timer);
        fail();
    };
    document.head.appendChild(s);
}

$('map-retry-btn').onclick = () => {
    $('map-fallback').hidden = true;
    $('aladin-lite').hidden = false;
    mapState = 'idle';
    initMap();
};

// --- Controls ----------------------------------------------------------------

$('search-btn').onclick = () => {
    const name = objSearch.value.trim();
    if (name) search(name);
};
objSearch.onkeydown = (e) => {
    if (e.key === 'Enter') {
        const name = objSearch.value.trim();
        if (name) search(name);
    }
};

$('coord-btn').onclick = () => {
    const ra = parseFloat($('ra-input').value);
    const dec = parseFloat($('dec-input').value);
    if (!Number.isFinite(ra) || ra < 0 || ra > 360 || !Number.isFinite(dec) || dec < -90 || dec > 90) {
        statusBar.textContent = 'Coordinates must be RA 0–360 and Dec −90–90 (degrees)';
        return;
    }
    state.targetName = null;
    objSearch.value = '';
    startJob(ra, dec);
};
['ra-input', 'dec-input'].forEach((id) => {
    $(id).onkeydown = (e) => { if (e.key === 'Enter') $('coord-btn').click(); };
});

playBtn.onclick = () => {
    if (viewer.isPlaying) viewer.stop();
    else viewer.start();
    syncPlayBtn();
};

colorBtn.onclick = async () => {
    state.color = !state.color;
    colorBtn.setAttribute('aria-pressed', String(state.color));
    writeUrl();
    // Cached cutouts are re-rendered server-side, so this never re-fetches.
    if (state.lastTarget) await startJob(state.lastTarget.ra, state.lastTarget.dec);
};

document.querySelectorAll('#mode-switcher .segmented-btn').forEach((btn) => {
    btn.onclick = () => setMode(btn.dataset.mode);
});

timelineSlider.oninput = () => {
    viewer.stop();
    syncPlayBtn();
    viewer.currentIdx = Number(timelineSlider.value);
    viewer.drawCurrent();
};

speedSelect.onchange = () => {
    state.speed = Number(speedSelect.value);
    viewer.setSpeed(state.speed);
    writeUrl();
};

stretchSelect.onchange = () => {
    state.stretch = stretchSelect.value;
    writeUrl();
    if (state.lastTarget) startJob(state.lastTarget.ra, state.lastTarget.dec);
};

function setExpert(on) {
    state.expert = on;
    document.body.classList.toggle('expert', on);
    expertBtn.setAttribute('aria-pressed', String(on));
    const item = viewer.activeList()[viewer.currentIdx];
    if (on && item) renderFrameWcs(item);
    writeUrl();
}
expertBtn.onclick = () => setExpert(!state.expert);

function setLowData(on, rerun = true) {
    state.lowData = on;
    document.body.classList.toggle('low-data', on);
    lowDataBtn.setAttribute('aria-pressed', String(on));
    writeUrl();
    if (rerun && state.lastTarget) startJob(state.lastTarget.ra, state.lastTarget.dec);
}
lowDataBtn.onclick = () => setLowData(!state.lowData);

$('share-btn').onclick = async () => {
    writeUrl();
    const url = location.href;
    try {
        await navigator.clipboard.writeText(url);
        statusBar.textContent = 'Share link copied to clipboard';
    } catch {
        window.prompt('Copy this share link:', url);
    }
};

sidebarBtn.onclick = () => {
    const open = document.body.classList.toggle('sidebar-open');
    sidebarBtn.setAttribute('aria-pressed', String(open));
};

// --- Keyboard shortcuts -------------------------------------------------------

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!$('tour-banner').hidden) exitTour();
        document.body.classList.remove('sidebar-open');
        sidebarBtn.setAttribute('aria-pressed', 'false');
        return;
    }
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === ' ') {
        e.preventDefault();
        playBtn.click();
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        viewer.step(1);
        syncPlayBtn();
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        viewer.step(-1);
        syncPlayBtn();
    } else if (e.key === '1') setMode('blink');
    else if (e.key === '2') setMode('flicker');
    else if (e.key === '3') setMode('timeline');
    else if (e.key === '4') setMode('difference');
    else if (e.key === 'c') colorBtn.click();
    else if (e.key === '/') {
        e.preventDefault();
        objSearch.focus();
    } else if (e.key === '?') {
        statusBar.textContent = 'Keys: Space play · ←/→ step · 1–4 modes · c colour · / search · Esc exit tour';
    }
});

// --- Init ---------------------------------------------------------------------

const badgeExtra = document.createElement('div');
badgeExtra.id = 'badge-extra';
badgeExtra.className = 'badge-line badge-muted';
badgeExtra.hidden = true;
$('meta-overlay').appendChild(badgeExtra);

initMap();
readUrl();