# System Patterns & Architecture

## Topology
```
[ Picanol OmniPlus-i XP_CBMP_P9 ]
              │ (24V Opto-isolated inputs)
              ▼
[ WT32-ETH01 Microcontroller ] (GPIO 4: STRT, 32: PP/PCNT, 33: WD, 14: FD)
              │ (HTTP POST with x-weavesync-key over LAN Ethernet)
              ▼
[ Next.js API Route /api/ingest/v1/batch ]
              ├── Cloud Mode: Supabase (PostgreSQL tables `looms`, `loom_live_state`, `loom_telemetry_history`, `loom_stoppages`)
              └── Local LAN Mode: In-Memory / SQLite Local Store (`/api/live/state`)
              ▼
[ WeaveSync Next.js 16 Web Dashboard ]
              ├── Supabase Realtime Channel (`table: loom_live_state`)
              └── Fallback Poller (`/api/live/state` if cloud offline)
```

## Hardware Pin Safety (WT32-ETH01)
- **Forbidden Pins**: GPIO 0 (RMII 50MHz Clock), GPIO 2 (strapping pin), GPIO 12 (strapping flash VDD), GPIO 15 (strapping pin).
- **Safe Assigned Pins**:
  - `GPIO 4`: `PIN_PI_STRT` (Loom Running)
  - `GPIO 32`: `PIN_PI_PP` (Pick Pulse - ESP32 Hardware PCNT Unit 0)
  - `GPIO 33`: `PIN_PI_WD` (Warp Stop)
  - `GPIO 14`: `PIN_PI_FD` (Filling / Weft Stop)

## Data Integrity Rules
- Zero mock data. No machines seeded unless received over hardware wire.
- `picksDelta` accumulated server-side using monotonic `seq` to handle reboots safely.
- Offline status auto-triggered if `now - last_heartbeat_at > 60000ms`.
