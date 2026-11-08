# STATE

Updated: 2026-11-08 · Phase 0 (service verification) complete

## Done
- Repo skeleton, git init, venv on Python 3.13.3 (system 3.8.6 too old)
- All services verified with live calls; recorded in docs/service-findings.md
- PLAN.md written
- Probes kept in probe/ with recorded real responses as JSON
- Phase 1 (Backend) complete:
  - FastAPI app with strict schemas, CORS, token bucket rate limiter, SSRF allow-list
  - Science core: A-WCS detector position, WCS-WAVE node grid 2D interp, spectral matching guard
  - On-disk caching, background cutout jobs (polite semaphore), difference computation
  - 5 backend unit tests passing (test_science.py, test_api.py)

## Verified service facts
- IRSA TAP `spherex.obscore`: 1.6M rows; QR2+QR3 (+_deep, +_cal); cone search 15s
- Unconstrained aggregate = 106s. Never query without a spatial constraint.
- DataLink → IBE cutout `https://irsa.ipac.caltech.edu/ibe/cutout?path&ra&dec&size`
- Cutout latency 31–120s, ~5MB; PSF cube is ~97% of bytes; full frame is 71MB
- Cutout HDUs: IMAGE, FLAGS, VARIANCE, ZODI, PSF, WCS-WAVE
- `WCS-WAVE`: 9×14 node grid → (wavelength µm, bandwidth µm); WAVE-TAB
- Band name = detector only (D1–D6). D3 spans 1.63–2.43µm; one pixel ~0.046µm (R≈40)
- **MEASURED: one sky point, D3, across 20 visits over 398 days → wavelength
  1.6258–2.4126µm = 15.7 bandwidths spread; target lands on detector rows 28–2018.
  This is the false-motion mechanism, proven. Band-name matching is unsafe.**
- MOST: `cgi-bin/MOST/nph-most?catalog=spherex&input_type=name_input&obj_name=3I`
  (`spherex_qr2`→HTTP 400; `3I/ATLAS`→HORIZONS lookup fails; use `3I`/`C/2025 N1`)
  → 359 matched frames for 3I/ATLAS, cols ra_obj/dec_obj/observationid/productid/mjd_start
  Results are files under the returned workspace URL (imgframes_matched_final_table.tbl)
- JPL SBDB: 3I/ATLAS e=6.1235, a=-0.264au, i=175.2° → hyperbolic, interstellar
- Name resolution: NED `ObjectLookup` works. ALL CDS hosts (Sesame/SIMBAD/VizieR)
  time out from this network → NED primary, CDS optional fallback
- Python needs certifi explicitly (framework install has no CA bundle)

## Key decisions
- Match on per-pixel LVF wavelength, never band name. Tolerance = 1 bandwidth, shown in UI.
- Full-detector pixel from the `A` alternate WCS (`0-based active pixel coordinates`).
  NOTE: `CRPIX1-CRPIX1W` is a tautology (both shift with the cutout) → always ~1020. Rejected.
- Cutouts = background jobs streaming frames; never block a request.
- Discard PSF/ZONDI after parsing; cache only IMAGE/VARIANCE/FLAGS/WCS-WAVE.
- Align with SIP-aware `all_world2pix` (CTYPE has -SIP).
- Allow-list: irsa.ipac.caltech.edu, ned.ipac.caltech.edu, ssd-api.jpl.nasa.gov,
  nasa-irsa-spherex.s3.us-east-1.amazonaws.com (+CDS fallback)

## Open questions (batched, for the user)
1. Default cutout size (0.02° ≈ 18px vs larger/slower)?
2. Wavelength tolerance default (1 bandwidth vs stricter)?
3. Include QR2+QR3 together, or let the user pick a release?
4. Difference mode: require same detector AND wavelength match, or allow
   cross-detector when wavelengths coincide?

## Next (Phase 1 — backend)
- pyproject with pinned deps; app skeleton (FastAPI)
- resolve (NED), search (TAP), wavelength (WCS-WAVE + A-WCS), match, cutout jobs, cache
- Unit tests incl. the band-mixing guard, using recorded fixtures

## In flight
- probe/wave_correct.py validating the `A`-WCS detector-position fix and
  measuring wavelength spread across visits at a fixed sky point.
