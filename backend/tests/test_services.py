"""MOST designation aliases and in-process cache.

Transport responses below are synthetic unit fixtures (not recorded science
data); they exist only to exercise parsing and cache behaviour offline.
"""
from __future__ import annotations

from backend.app import services


def test_most_designation_aliases():
    assert services.most_designation("3I/ATLAS") == "3I"
    assert services.most_designation(" 3i ") == "3I"
    assert services.most_designation("C/2025 N1") == "C/2025 N1"
    assert services.most_designation("M51") == "M51"


def test_most_query_normalizes_and_caches(monkeypatch):
    from astropy.table import Table
    import io
    calls = []
    html = b'<a href="https://irsa.ipac.caltech.edu/workspace/abc/MOST/pid123">ws</a>'

    t = Table([['obs1'], ['D1'], [60000.5], [10.0], [20.0], [18.2], [1.9], [2.1]],
              names=('observationid', 'productid', 'mjd_start', 'ra_obj', 'dec_obj', 'vmag', 'geo_dist', 'sun_dist'))
    buf = io.StringIO()
    t.write(buf, format='ascii.ipac')
    tbl = buf.getvalue().encode()

    def fake_fetch(url, **kwargs):
        calls.append(url)
        if url == services.config.IRSA_MOST:
            assert kwargs["params"]["obj_name"] == "3I"
            return html
        return tbl

    monkeypatch.setattr(services.fetcher, "safe_fetch", fake_fetch)
    monkeypatch.setattr(services, "_MOST_CACHE", {})

    rows = services.query_most_moving_object("3I/ATLAS")
    assert rows[0]["obs_id"] == "obs1"
    assert rows[0]["ra_predicted"] == 10.0
    assert rows[0]["dec_predicted"] == 20.0

    # Second call (different alias, same target) must be served from cache
    again = services.query_most_moving_object("3I")
    assert again == rows
    assert len(calls) == 2  # submit + table fetched exactly once