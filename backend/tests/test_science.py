"""Unit test: prove that frames from different spectral channels are NEVER
compared as equivalent (Critical Science Rule #3).
"""
from __future__ import annotations

import json
from backend.app import science


def test_spectral_channel_matching_guard():
    # Load real recorded epoch spread data from Phase 0
    with open("probe/recorded_wave_correct.json", "r") as f:
        recorded_frames = json.load(f)

    # Frame 0 is 2026W21_1A_0499_1 (2.0838 um)
    # Frame 1 is 2026W25_2A_0123_1 (1.6448 um)
    assert len(recorded_frames) >= 2

    # Under 1.0-bandwidth tolerance, they MUST NOT match
    matched, diag = science.match_spectral_channels(
        recorded_frames,
        target_wavelength_um=recorded_frames[0]["wavelength_um"],
        tolerance_bandwidths=1.0,
    )

    # Prove that the 1.6448 um frame was rejected when anchoring at 2.0838 um
    matched_ids = [m["obs_id"] for m in matched]
    assert "2026W25_2A_0123_1" not in matched_ids
    assert diag["rejected_count"] if "rejected_count" in diag else len(diag["rejected"]) > 0


def test_difference_frame_neutral_mid_gray():
    import numpy as np
    a = np.ones((10, 10), dtype=np.float32) * 5.0
    b = np.ones((10, 10), dtype=np.float32) * 5.0
    diff = science.compute_difference_frame(a, b)
    # Identical frames must yield uniform neutral mid-gray (128)
    assert np.all(diff == 128)
