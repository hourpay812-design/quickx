# Security Policy

## Threat Model & SSRF Control
QuickX strictly enforces an outbound HTTP allow-list restricting external calls to:
- `irsa.ipac.caltech.edu`
- `ned.ipac.caltech.edu`
- `ssd-api.jpl.nasa.gov`
- `nasa-irsa-spherex.s3.us-east-1.amazonaws.com`

Any requests outside this allow-list or attempting to resolve internal metadata services (e.g. `169.254.169.254`) are immediately rejected.

## Rate Limiting & Abuse Prevention
API endpoints are protected by token-bucket rate limits per client IP, along with strict input validation via Pydantic schemas.
