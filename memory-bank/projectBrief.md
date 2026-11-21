# Project Brief: WeaveSync SCADA (Ali Haider Industries)

## Core Objective
Deliver a production-ready, zero-mock Industrial SCADA & IIoT monitoring system for 36 Picanol OmniPlus-i air-jet weaving looms at Ali Haider Industries in Faisalabad, Pakistan.

## Foundational Mandate: Zero Mock Data
- No machines appear in the UI without real hardware transmitting telemetry.
- Telemetry originates from WT32-ETH01 hardware adapters wired to Picanol XP_CBMP_P9 optical interface or Edge Gateway.
- Auto-registration of hardware via MAC address / chip ID.
- Status strictly computed from last heartbeat timestamp (Online <15s, Stale 15-60s, Offline >60s).
- Truthful dual-mode transport: Cloud (Supabase Realtime) with graceful local LAN fallback (`/api/live/state`).

## Quality Standards
- Strict industrial minimalism: Shadcn UI, clean light canvas, zero emojis, zero duplicate icons, zero dev jargon.
- Exact ISO 22971 / Picanol stoppage reason classification.
- All clocks and shift boundaries locked to Asia/Karachi (PKT).
