const state = {
    jobId: null,
    frames: [],
    currentIdx: 0,
    playing: false
};

const canvas = document.getElementById("blink-canvas");
const ctx = canvas.getContext("2d");

async function search(name) {
    const res = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
    });
    const obj = await res.json();
    console.log("Resolved:", obj);

    const searchRes = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ra: obj.ra, dec: obj.dec })
    });
    const coverage = await searchRes.json();
    console.log("Coverage:", coverage);

    // Trigger job
    const jobRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ra: obj.ra, dec: obj.dec })
    });
    const job = await jobRes.json();
    state.jobId = job.job_id;
    pollJob();
}

async function pollJob() {
    if (!state.jobId) return;
    const res = await fetch(`/api/jobs/${state.jobId}`);
    const job = await res.json();

    document.getElementById("status-bar").textContent = `Job: ${job.status} (${job.progress}/${job.total})`;

    if (job.frames.length > 0) {
        state.frames = job.frames;
        renderFrame();
    }

    if (job.status === "running") {
        setTimeout(pollJob, 2000);
    }
}

function renderFrame() {
    if (state.frames.length === 0) return;
    const frame = state.frames[state.currentIdx];
    const img = new Image();
    img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        document.getElementById("meta-overlay").innerHTML =
            `ID: ${frame.obs_id}<br>Wave: ${frame.wavelength_um}µm<br>BW: ${frame.bandwidth_um}µm`;
    };
    img.src = `data:image/png;base64,${frame.png_b64}`;
}

document.getElementById("search-btn").onclick = () => {
    const name = document.getElementById("obj-search").value;
    if (name) search(name);
};

document.getElementById("play-btn").onclick = () => {
    state.playing = !state.playing;
    document.getElementById("play-btn").textContent = state.playing ? "Pause" : "Play";
    if (state.playing) animate();
};

function animate() {
    if (!state.playing) return;
    state.currentIdx = (state.currentIdx + 1) % state.frames.length;
    renderFrame();
    setTimeout(animate, 500);
}
