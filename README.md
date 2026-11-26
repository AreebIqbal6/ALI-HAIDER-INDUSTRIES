This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Device ingest (Data Contract v1)

Loom loggers (`firmware/ldl-wt32`) POST batches over HTTPS; messages are stored idempotently in Supabase.
Golden examples and the contract summary live in [`contract/v1/`](contract/v1/README.md); the backend validators
(`src/lib/contract`) and the firmware tests must both accept those files unchanged.

**Endpoint:** `POST /api/ingest/v1/batch`, header `Authorization: Bearer <device token>`, body
`{ deviceId, envelopes: [...] }` (max 50). Envelope schemas: `ahi.loom.state/1.0`, `ahi.loom.event/1.0`,
`ahi.loom.counters/1.0`, `ahi.device.health/1.0`.

| Response | Meaning | Device action |
| --- | --- | --- |
| 200 `{serverTime, results:[{msgId, status, reason?}]}` | `stored` / `duplicate` / `rejected` per message (an older or replayed state is stored to history and reported as `stored`) | delete `stored`/`duplicate`; delete + log `rejected` |
| 400 | body is not JSON / not `{deviceId, envelopes[]}` | fix firmware |
| 401 | missing/unknown/disabled token, or `deviceId` does not match the token | back off 5 min |
| 413 | more than 50 envelopes (or body > 256 KB) | split the batch |
| 429 | more than 120 requests/min for this device (per server instance) | back off |
| 503 | database unavailable / not configured | keep buffered, retry 2 s..5 min |

Rules enforced by the server: `msgId` UUIDv7 (dedup key, `loom_events.msg_id`), `machineId` must equal the device's
registered loom, `ts` ISO-8601 UTC with `Z`. A `ts` more than 5 min in the future is stored but marked `ESTIMATED` and
the server receive time is used for ordering. Dashboard liveness comes only from `looms.last_heartbeat_at`
(server receive time). The live state only moves forward: `(ts, bootId, seq)` must be newer and `replayed=false`.

### 1. Apply migration 006
Run `supabase/migrations/006_contract_v1.sql` in the Supabase SQL editor (or `psql`) after `001_initial_schema.sql`.
It is idempotent. It adds `devices`, `device_health`, ordering columns, and the service-role-only functions
`ingest_message(jsonb, timestamptz)` and `provision_device(...)`.
Note: `002_downtime_trigger.sql` and `005_factory_state_rpc.sql` reference tables/columns that do not exist; they are
not needed and should not be applied as-is.

### 2. Vercel environment
Set (Production + Preview): `NEXT_PUBLIC_ENABLE_SUPABASE=true`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only, never `NEXT_PUBLIC_`),
`ADMIN_API_KEY` (for `DELETE`, header `x-admin-key`). Leave `LEGACY_INGEST_KEY` empty unless the old LAN pilot
firmware must keep working, and keep `DEMO_MODE` unset (it seeds a fake `DEMO-0001` loom). See `.env.example`.

### 3. Provision a logger
```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/provision-device.mjs --device e0e2e6aabbcc --machine PIC-427708 --loom-number 1
```
Creates/updates the loom and device, stores only the SHA-256 of a new random token, and prints the token once.
Running it again for the same device rotates the token. Disable a device with
`UPDATE devices SET status = 'disabled' WHERE device_id = '...';`

### 4. Simulate loggers
```bash
SIM_DEVICE_TOKEN=<token> node scripts/sim-http.mjs --url http://localhost:3000 \
  --device e0e2e6aabbcc --machine PIC-427708 [--ticks 20] [--dup] [--replay] [--skew]
# several looms: --looms looms.json  ([{"deviceId","machineId","token"}, ...])
```
`--dup` re-sends every batch and checks that all results are `duplicate`; `--replay` first sends a replayed backlog;
`--skew` sends timestamps 10 min ahead.

### Tests
`npm test` (vitest): contract validation against the golden files, mutated invalid cases, UUIDv7, skew rule, and the
route with a mocked `IngestStore`.
