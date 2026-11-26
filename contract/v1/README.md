# Data Contract v1 — HTTP ingest (golden examples)

Shared by the logger firmware (firmware/ldl-wt32) and the backend (src/lib/contract).
Both test suites must accept these files unchanged. Change them only together.

POST /api/ingest/v1/batch
Authorization: Bearer <device token>   (per device; server stores SHA-256 only)
Body: batch_request.json shape, <= 50 envelopes.
Response 200: batch_response.json shape. stored|duplicate -> device deletes from buffer;
rejected -> device deletes + logs. 401 -> back off 5 min. 429/5xx/network -> backoff 2 s..5 min, keep buffered.
tsQuality: SYNCED (SNTP) | ESTIMATED (from serverTime or uptime). ts is ISO-8601 UTC with ms and 'Z'.
msgId and stopId are UUIDv7. bootId increments on every boot (NVS). seq restarts at 1 each boot.
