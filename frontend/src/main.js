import { QuickXClient, Viewer } from './app.js';

const client = new QuickXClient();
const viewer = new Viewer(document.getElementById('blink-canvas'));

const state = {
    jobId: null,
    frames: [],
    currentIdx: 0,
    playing: false
};

const statusBar = document.getElementById('status-bar');
const searchBtn = document.getElementById('search-btn');
const objSearch = document.getElementById('obj-search');
const playBtn = document.getElementById('play-btn');
const metaOverlay = document.getElementById('meta-overlay');
const epochsList = document.getElementById('obs-list');

async function search(name) {
    try {
        statusBar.textContent = 'Resolving name...';
        const obj = await client.resolve(name);

        statusBar.textContent = 'Creating job...';
        const job = await client.createJob({
            ra: obj.ra,
            dec: obj.dec,
            stretch: 'asinh'
        });

        state.jobId = job.job_id;
        pollJob();
    } catch (err) {
        statusBar.textContent = `Error: ${err.message}`;
        console.error(err);
    }
}

async function pollJob() {
    if (!state.jobId) return;
    try {
        const job = await client.getJob(state.jobId);
        statusBar.textContent = `Job: ${job.status} (${job.progress}/${job.total})`;

        if (job.frames.length > 0) {
            state.frames = job.frames;
            viewer.setFrames(job.frames);
            renderEpochList(job.frames);
        }

        if (job.status === 'running' || job.status === 'pending') {
            setTimeout(pollJob, 1000);
        }
    } catch (err) {
        statusBar.textContent = `Polling error: ${err.message}`;
    }
}

function renderEpochList(frames) {
    epochsList.innerHTML = '';
    frames.forEach((f, i) => {
        const el = document.createElement('div');
        el.className = 'epoch-item p-2 text-xs border-b border-white/5 cursor-pointer hover:bg-white/5';
        el.innerHTML = `
            <div class="flex justify-between">
                <span>${f.obs_id.split('_').slice(-2).join('_')}</span>
                <span>${f.wavelength_um}µm</span>
            </div>
        `;
        el.onclick = () => {
            viewer.stop();
            viewer.currentIdx = i;
            viewer.drawCurrent();
        };
        epochsList.appendChild(el);
    });
}

searchBtn.onclick = () => {
    const name = objSearch.value.trim();
    if (name) search(name);
};

playBtn.onclick = () => {
    if (viewer.isPlaying) {
        viewer.stop();
        playBtn.textContent = 'Play';
    } else {
        viewer.start();
        playBtn.textContent = 'Pause';
    }
};

// Override Viewer.drawCurrent to update our specific overlay
const originalDraw = viewer.drawCurrent.bind(viewer);
viewer.drawCurrent = () => {
    originalDraw();
    if (viewer.frames.length > 0) {
        const frame = viewer.frames[viewer.currentIdx];
        metaOverlay.innerHTML = `
            <div class="text-cyan-400 font-mono">${frame.obs_id}</div>
            <div class="text-white">${frame.wavelength_um} µm ± ${frame.bandwidth_um}</div>
            <div class="text-slate-400 text-[10px]">${new Date(frame.date_obs).toLocaleString()}</div>
        `;
    }
};
