/**
 * QuickX Spectrum Plotter
 */
export function renderSpectrum(points) {
  const container = document.getElementById('spectrum-plot');
  container.innerHTML = '';
  if (!points.length) return;

  const maxFlux = Math.max(...points.map(p => p.flux_mjy_sr || 0));

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "110");
  svg.setAttribute("viewBox", `0 0 ${points.length * 20} 110`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Spectral energy distribution across ${points.length} bands`);

  points.forEach((p, i) => {
    const h = (p.flux_mjy_sr / (maxFlux || 1)) * 90;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", i * 20 + 2);
    rect.setAttribute("y", 100 - h);
    rect.setAttribute("width", "16");
    rect.setAttribute("height", Math.max(h, 1));
    rect.setAttribute("fill", "var(--accent-color)");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${p.wavelength_um} µm: ${p.flux_mjy_sr} MJy/sr`;
    rect.appendChild(title);
    svg.appendChild(rect);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", i * 20 + 10);
    label.setAttribute("y", 108);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "6");
    label.setAttribute("fill", "var(--text-muted)");
    label.textContent = p.wavelength_um.toFixed(2);
    svg.appendChild(label);
  });
  container.appendChild(svg);
}