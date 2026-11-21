# Product Context: WeaveSync SCADA

## Target Audience
- **Mill Owner / CEO**: Wants high-level truth (Fleet efficiency, live looms running, shift production in meters, downtime Pareto).
- **Floor Supervisors & Weaving Masters**: Need instant visibility into stopped machines, ticking stop duration timers, and quick one-tap stop reason logging (7 standard ISO codes).
- **Maintenance / Electrical Engineers**: Need dedicated, tucked-away Hardware Diagnostics (safe GPIO status, PHY link, heartbeat latency, raw pin edge history).

## Key User Journeys
1. **Empty Factory State (0 connected)**: The dashboard clearly states "No Looms Connected" with an active listening beacon, showing the server's LAN endpoint and ready status.
2. **First Hardware Power-on**: When an ESP32 connects and posts to `/api/ingest/v1/batch`, the loom card appears live within <1s without reloading.
3. **Machine Configuration**: Unlabeled auto-registered looms prompt the supervisor to assign Loom #, Model, Article, Setpoint RPM, and Weft Density.
4. **Machine Stoppage Handling**: When a loom stops for >5 minutes, the card highlights the event and offers a clean modal dialog to log the cause (ART, KNT, ELE, MEC, BST, DOF, OLS).
5. **Shift Analytics**: Clear view of production metrics strictly compiled from real records during Shift A (08:00–20:00 PKT) and Shift B (20:00–08:00 PKT).
