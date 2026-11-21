# Technical Context: WeaveSync SCADA

## Stack & Versions
- **Framework**: Next.js 16.3.0 (App Router), React 19.2.8
- **Styling**: Tailwind CSS v4 (`@tailwindcss/postcss`)
- **UI Components**: Shadcn UI primitives (`@radix-ui/react-dialog`, `@radix-ui/react-tabs`, `@radix-ui/react-separator`, `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`)
- **Icons**: Lucide React
- **Validation**: Zod
- **Database / Realtime**: Supabase (`@supabase/supabase-js`)
- **Firmware**: Arduino C++ / ESP-IDF for WT32-ETH01 with LAN8720A Ethernet PHY
- **Edge Gateway**: Node.js 22 LTS TypeScript collector & forwarder with SQLite WAL

## Environment Configuration
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key for client realtime read
- `SUPABASE_SERVICE_ROLE_KEY`: Server-only key for write operations in `/api/ingest`
- `INGEST_API_KEY`: Secret matching header `x-weavesync-key` from hardware devices
- `TIMEZONE`: `Asia/Karachi` (PKT, UTC+5)
