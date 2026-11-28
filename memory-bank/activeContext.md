# Active Context: Production Cloud & Hardware Pilot Readiness

## Focus
Full-stack Cloud Live SCADA (Next.js 16 + Supabase PostgreSQL/Realtime + Vercel) paired with Data Contract v1 (`ldl-wt32` ESP-IDF firmware) and Local LAN fallback (`localStore.ts`).

## Latest Verified State (`fcb97ff`+)
- **Production Website (`https://ali-haider-industries.vercel.app/`)**: Deployed & verified live in desktop + mobile (`390x844`, `0px` overflow) Chromium with `Cloud Live` status, tightened `connect-src` CSP, `/robots.txt`, `/manifest.webmanifest`, custom 404, and `0` console errors/warnings.
- **Verification**: 80/80 Vitest tests pass (`tests/contract.test.ts`, `tests/ingest-route.test.ts`, `tests/operator-routes.test.ts`, `tests/telemetry-shift.test.ts`, `tests/firmware-events.test.ts`), ESLint clean, TypeScript clean (root + `edge-gateway`), `next build` clean.
- **Pending Manual Step**: Apply `supabase/migrations/007_rls_security_hardening.sql` in the Supabase SQL Editor for `viiilmbgqldwlzyarmdz.supabase.co` to close the `001` `WITH CHECK (true)` anon-insert RLS loophole and add shift/downtime indexes.
