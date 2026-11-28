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

## [2026-11-23] 100% Offline Local Industrial Persistence (Zero Cloud Dependency)

### Problem
Supabase free tier automatically paused project `ALI-HAIDER-INDUSTRIES` due to account limits. Continuing to rely on an external cloud database caused network timeouts (`net::ERR_NAME_NOT_RESOLVED`), blocked unpausing without a paid plan, and violated industrial plant reliability standards where a weaving shed SCADA system must never stop functioning if cloud SaaS accounts expire.

### Resolution
1. **Permanent Local Disk Persistence**: Overhauled `src/lib/localStore.ts` to automatically persist all auto-registered looms, live states, pick counters, and operator stoppage declarations to `data/local_store.json` using atomic disk writes. Data survives server reboots completely without any cloud database.
2. **Eliminated Cloud Overhead & Console Errors**: Set `NEXT_PUBLIC_ENABLE_SUPABASE="false"` and `OFFLINE_MODE="true"`. Bypassed all outgoing REST and WebSocket connections to dead Supabase URLs. Verified zero browser console errors (0 errors, 0 warnings across all routes).
3. **Automated Verification**: `npm run verify-pilot` passes 5/5 steps strictly offline. Production build (`npm run build`) passes cleanly with exit code 0.

## [2026-11-23] Hardware Specification & Connection Alignment (WT32-ETH01 -> Laptop -> WeaveSync)

### Physical Interface & Signal Conditioning
1. **Picanol OmniPlus-i XP_CBMP_P9 Tap**: Tapped Pin 9 (`PI_STRT`), Pin 7 (`PI_PP` beat-up @ 14.57 Hz / 874 RPM), Pin 8 (`PI_WD` warp stop), and Pin 10 (`PI_FD` weft stop) with 2.2kΩ (0.5W) series resistors into a 4-channel PC817 optocoupler board.
2. **Galvanic Isolation & Safe Pinout**: Optocoupler inputs powered strictly from the 24V loom bus; outputs powered from WT32-ETH01 `3V3` with 4.7kΩ pull-ups (`OPTO_ACTIVE_LOW = true`). Mapped to non-strapping safe GPIOs: GPIO 4 (`PI_STRT`), GPIO 32 (`PI_PP`), GPIO 33 (`PI_WD`), GPIO 14 (`PI_FD`). GPIO 0, 2, 12, 15 and RMII pins are untouched.
3. **Pick Counting Architecture**: Counted strictly 1:1 via ESP32 Hardware Pulse Counter (`PCNT_UNIT_0`, Channel 0) with a 200-cycle APB glitch filter. Zero double-counting interrupts.

### Network Layer & Ingestion Alignment
1. **Laptop Ethernet Interface (`START_PILOT.bat`)**: Automated physical adapter detection in PowerShell. Configures static IP `192.168.10.1`, subnet mask `255.255.255.0`, and default gateway `none` to prevent hijacking Wi-Fi/cellular hotspot internet. Sets network profile to `Private` and opens firewall ports 3000, 4841, 1883.
2. **WT32-ETH01 Static IP Fallback**: Requests DHCP for 2.5s; falls back to static IP `192.168.10.2` (gateway `192.168.10.1`). On direct cable link-up without DHCP, firmware explicitly asserts `eth_connected = true` and retrieves the hardware MAC.
3. **Schema & Telemetry Unification**: Unified `DirectHardwarePayloadSchema` and `/api/ingest/v1/batch` to accept both raw hardware frames (`picksTotal`, `fw`, `rawPinHistory` at root) and canonical envelopes with `x-weavesync-key` validation. Ingest ACK returns HTTP 200 with clear 1-line serial diagnostic telemetry every 5s.

## [2026-11-23] Unslop Execution: Polish Mode & Anti-AI-Slop Refinement

### Direction
- **Product:** Industrial SCADA and telemetry monitor for airjet weaving looms at Ali Haider Industries.
- **Character:** Exact, calm, mechanical.
- **World:** Weaving shed floor, steel reed frames, yarn cones, and control cabinets under shift lighting.
- **Moments:** 
  1. The live beat-up pulse and optocoupler pin inspector with 1:1 hardware transition timings.
  2. The shift downtime Pareto chart mapping warp, weft, and mechanical stop minutes.
- **Signature:** A crisp mono beat-up frequency reading (`874 RPM · 14.57 Hz`) and mill status dot without decorative halos.

### 9-Pass Refinement Summary
1. **Spacing:** Standardized all margins, paddings, and card gaps to the 4px scale. Balanced rhythm in stat grids and removed arbitrary sizing.
2. **Color:** Neutralized chrome and stat numbers to unified dark slate ink (`text-slate-900`), removing artificial green and blue fills from basic counts and meters. Calmed active tab states to refined surface steps (`bg-slate-800` / `bg-slate-900`) with hairlines.
3. **Icons:** Removed decorative and redundant icons (bar chart before analytics title, clock before downtime Pareto, gauge before telemetry table). Retained only purposeful line icons at 14–16px stroke 1.5. Eliminated blurry glowing halos around status dots.
4. **Copy & Type:** Replaced shouty ALL-CAPS uppercase tracked labels (`SHIFT EFFICIENCY`, `ACTIVE RUNNING`) with professional sentence-case typography (`Shift efficiency`, `Active looms`, `Shift output`). Removed formulaic subtext (`Verified (Run / Elapsed)` -> `Target: 92.0%`).
5. **Details & Radii:** Nested radii (`rounded-xl` for cards, `rounded-lg` for inputs/controls, eliminated arbitrary full pills). Removed duplicate connection status pill from the floor subheader so the shift context breathes cleanly.
6. **Verification:** `npm run build` compiled with code 0. `npm run verify-pilot` passed 5/5. Playwright headless browser audit confirmed 0 console errors and 0 warnings.


## [2026-11-28] Full-Stack Audit, Cloud Live Fixes, RLS Hardening & Verification (`fcb97ff`)

### Issues Identified & Resolved
1. **Cloud Live Telemetry & Realtime (`TelemetryContext.tsx`, `types/index.ts`):**
   - Stopped `fetchSupabaseLooms()` from falling back to empty `/api/live/state` on transient errors (which wiped Cloud looms).
   - Added `'CONNECTING'` startup status so Cloud mode avoids flashing `Disconnected` before initial fetch resolves.
   - Paginated `loom_minute_counters` queries in 1,000-row chunks to prevent PostgREST silent truncation on multi-loom 12h shifts.
   - Subscribed Realtime to both `looms` and `loom_live_state`, handled `DELETE` events, updated heartbeat tracking using fresher `updated_at`, fixed `device_health` lookup by `machine_id`, preserved `article_name`, and fixed shift rollover carryover & `metresWoven` jumps.
2. **UI Flows, Validation & Anti-Slop Polish (`MachineMatrixGrid.tsx`, `Header.tsx`, `LoomDashboard.tsx`, `AnalyticsDashboard.tsx`, `error.tsx`, `layout.tsx`, `manifest.ts`, `robots.ts`):**
   - Wired the **Configure** button on loom cards to the previously unreachable modal, switched numeric fields to string inputs with submit validation, prefilled modal values, and allowed editing already-declared stop reasons.
   - Aligned Cloud empty-state copy with Contract v1 (`Authorization: Bearer <device token>`), guarded `since` parsing against `NaN`, fixed null `stopCategory` displaying `'WARP'`, removed fabricated `3` min MTTR Pareto fallback, removed remaining `animate-pulse`/`font-black`, and added `manifest.ts` + `robots.ts`.
3. **API & Security Hardening (`operatorAuth.ts`, `configure-loom`, `declare-stop`, `next.config.ts`, `007_rls_security_hardening.sql`):**
   - Added 16 KB bounded body parsing (`413`), rate limiting, `sec-fetch-site: cross-site` CSRF check (`403`), optional `OPERATOR_API_KEY` check, `409 Conflict` on duplicate `loom_number`, `Cache-Control: no-store` on live state `GET` routes, and tightened `connect-src` CSP in `next.config.ts` to `'self'` + `*.supabase.co`.
   - Authored idempotent migration `supabase/migrations/007_rls_security_hardening.sql` to close the `001` `WITH CHECK (true)` anon-insert RLS loophole, add 3 query indexes, harden view/RPC security context, and ensure `looms`/`loom_live_state` are in `supabase_realtime`.

### Verification
- `npm test`: 5/5 files, 80/80 tests passed.
- `npm run lint`: 0 errors, 0 warnings.
- `npx tsc --noEmit` (root + `edge-gateway`): 0 errors.
- `npm run build`: clean production build (Next.js 16.3.0 Turbopack).
- Live Playwright inspection on `https://ali-haider-industries.vercel.app/` (desktop + `390x844` mobile, `/`, `/analytics`, `/nonexistent-404-check`): `Cloud Live` verified, `0px` mobile horizontal overflow, `0` console errors/warnings on `/` and `/analytics`, tightened CSP and `/robots.txt` + `/manifest.webmanifest` HTTP 200 confirmed.
- Remaining user action: Execute `supabase/migrations/007_rls_security_hardening.sql` in the Supabase SQL Editor (live `anon` probe confirmed `007` is not yet applied on `viiilmbgqldwlzyarmdz.supabase.co`).
