# QuickX

Free public web tool to blink compare NASA SPHEREx spectral images.

## Features
- Search by object name (NED) or RA/Dec coordinates.
- Linear Variable Filter (LVF) exact per-pixel wavelength matching.
- Blink, Flicker, and Difference image modes.
- Guided tour of interstellar comet 3I/ATLAS.

## Quickstart

### Backend
```bash
python3.13 -m venv .venv
source .venv/bin/activate
pip install -e backend/
uvicorn backend.app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Running Tests
```bash
pytest backend/tests/
```
