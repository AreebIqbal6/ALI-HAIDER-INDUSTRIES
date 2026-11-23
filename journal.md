# Architecture & Engineering Journal: WeaveSync SCADA

## [2026-11-22] Complete Zero-Mock Architectural Overhaul

### Problem Statement
The prior prototype relied heavily on synthetic frontend simulations: hardcoding 36 looms (`OFFICIAL_FLEET_DEFINITIONS`), simulating machine faults, displaying fake solar generation curves (Huawei SUN2000), and presenting developer tags ("Section 11 Verified Formulas", "CEO pitch"). This created an illusion of functionality without validating actual hardware-to-cloud data pathways.

### Architectural Decisions
1. **Zero-Mock Policy**: An empty database must render an empty UI with an active listening indicator. A loom only exists once an authenticated hardware device (identified by MAC address) transmits valid GPIO/PCNT telemetry.
2. **True Dual-Mode Fallback**: A local in-memory/SQLite store on the edge/laptop handles ingestion and serves `/api/live/state` when cloud internet connectivity drops, with the UI reflecting truthful status pills (`Cloud Live`, `Local LAN Mode`, `Disconnected`).
3. **Industrial Minimalism (Shadcn UI)**: Eliminate all emojis, gradient buttons, and floating glow elements. Adopt high-contrast zinc-50 canvas, flat white cards with subtle 1px border, and tabular monospace numbers.
4. **Firmware Integrity (WT32-ETH01)**: Restrict to non-strapping safe GPIOs (4, 32, 33, 14), utilize dedicated ESP32 hardware PCNT for exact pick counting, and send incremental `picksDelta` with sequence numbers to eliminate reboot drift.


## [2026-11-23] Strict UI Freeze Zero-Mock Overhaul

### Scope & Constraints
- **Strict UI Freeze:** Retain the authentic dark industrial header (`bg-[#1e293b]`), `#e8ebf0` canvas, cards, typography, and component styling. Do NOT redesign or replace with a generic white theme.
- **Zero Mock:** Eliminate all hardcoded machine arrays (`OFFICIAL_FLEET_DEFINITIONS` generating 36 fake looms). Looms only exist when real hardware transmits live telemetry.
- **Truthful Transport:** Single read-only connection status pill in the header. Automatic fallback to local in-memory store when Supabase is unreachable.
- **Vibecoding & Slop Eradication:** Replace emojis with Lucide icons, remove developer jargon tags ("Section 11 Verified Formulas", "CEO pitch"), delete fake Shed Climate and Huawei Solar charts, lock all clocks to `Asia/Karachi`.
- **Hardware & Security:** Harden WT32-ETH01 firmware with safe non-strapping pins, hardware PCNT only, constant-time `x-weavesync-key` validation, rate limiting, and strict security headers in `next.config.ts`.

### Resolution & Implementation Details
1. **Dynamic Local Store & Zero-Mock Ingestion**: `src/lib/localStore.ts` starts strictly with 0 looms. Real machines auto-register dynamically on receiving authenticated hardware telemetry at `/api/ingest/v1/batch` with MAC-based `deviceId`. Monotonic sequence checks and bounded `recentMsgIds` cache eliminate replay attacks.
2. **Graceful Handling of Paused Cloud Instances**: When Supabase is paused or disconnected, the client suppresses recursive WebSocket reconnection attempts and falls back seamlessly to the low-latency Local LAN store (`/api/live/state`), displaying the truthful `Local LAN` status pill.
3. **Analytics & Empty States**: Purged the synthetic Huawei SUN2000 solar curves and hardcoded downtime arrays from `src/views/AnalyticsDashboard.tsx`. Rendered an authoritative industrial empty state when 0 machines are connected, while computing real OEE, availability, and stoppage Pareto breakdowns when live hardware is streaming data.
4. **Security & Production Hardening**: Installed strict security headers (CSP, HSTS, X-Frame-Options: DENY, X-Content-Type-Options: nosniff), suppressed production source maps, created Next.js error boundary (`src/app/error.tsx`), and verified 100% passing tests via `npm run verify-pilot` and `npm run build`.
