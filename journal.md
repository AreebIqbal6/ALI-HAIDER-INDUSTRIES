# Architecture & Engineering Journal: WeaveSync SCADA

## [2026-11-22] Complete Zero-Mock Architectural Overhaul

### Problem Statement
The prior prototype relied heavily on synthetic frontend simulations: hardcoding 36 looms (`OFFICIAL_FLEET_DEFINITIONS`), simulating machine faults, displaying fake solar generation curves (Huawei SUN2000), and presenting developer tags ("Section 11 Verified Formulas", "CEO pitch"). This created an illusion of functionality without validating actual hardware-to-cloud data pathways.

### Architectural Decisions
1. **Zero-Mock Policy**: An empty database must render an empty UI with an active listening indicator. A loom only exists once an authenticated hardware device (identified by MAC address) transmits valid GPIO/PCNT telemetry.
2. **True Dual-Mode Fallback**: A local in-memory/SQLite store on the edge/laptop handles ingestion and serves `/api/live/state` when cloud internet connectivity drops, with the UI reflecting truthful status pills (`Cloud Live`, `Local LAN Mode`, `Disconnected`).
3. **Industrial Minimalism (Shadcn UI)**: Eliminate all emojis, gradient buttons, and floating glow elements. Adopt high-contrast zinc-50 canvas, flat white cards with subtle 1px border, and tabular monospace numbers.
4. **Firmware Integrity (WT32-ETH01)**: Restrict to non-strapping safe GPIOs (4, 32, 33, 14), utilize dedicated ESP32 hardware PCNT for exact pick counting, and send incremental `picksDelta` with sequence numbers to eliminate reboot drift.
