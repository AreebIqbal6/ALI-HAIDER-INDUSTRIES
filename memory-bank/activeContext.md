# Active Context: System Overhaul Sprint

## Focus
Executing complete zero-mock system overhaul across Database, API routes, Telemetry Context, UI Components, and Firmware.

## Current Milestone
- Milestone 1: Dependencies installed (Zod, Radix UI, CVA, Tailwind Merge).
- Milestone 2 (Next): Database migration cleanup (`docs/fleet-reference.md`, clean migrations with RLS).
- Milestone 3: API hardening (`/api/ingest/v1/batch`, `/api/operator/declare-stop`, `/api/live/state`).
- Milestone 4: Telemetry Context overhaul (delete all mock generators, real empty state).
- Milestone 5: Shadcn UI rebuild (Header, KPI Strip, Loom Matrix Grid, Stop Reason Dialog, Hardware Diagnostics Tab, Shift Analytics).
- Milestone 6: WT32-ETH01 Firmware hardening.
- Milestone 7: Standalone external verification suite & builds.
- Milestone 8: CodeRabbit 5-Lens quality gate & git push.
