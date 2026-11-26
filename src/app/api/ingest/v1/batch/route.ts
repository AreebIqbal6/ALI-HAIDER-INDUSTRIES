// src/app/api/ingest/v1/batch/route.ts — Data Contract v1 ingest endpoint.
//
// POST: loggers send `Authorization: Bearer <device token>` + {deviceId, envelopes[<=50]}.
//       Each envelope is validated and stored idempotently via Supabase RPC ingest_message.
//       The legacy x-weavesync-key path is available ONLY when LEGACY_INGEST_KEY is set.
// GET:  local LAN store snapshot (unchanged behaviour).
// DELETE: clears local/test looms; requires the x-admin-key header to equal ADMIN_API_KEY.
import type { NextRequest } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { clearAllLooms, clearTestLoom, getLocalStoreSnapshot } from '@/lib/localStore';
import { createBatchHandler, createSupabaseIngestStore, safeEqual } from '@/lib/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handleBatch = createBatchHandler({
  getStore: () => {
    const client = getServiceSupabase();
    return client ? createSupabaseIngestStore(client) : null;
  },
});

export async function POST(req: NextRequest) {
  return handleBatch(req);
}

export async function GET() {
  const snapshot = getLocalStoreSnapshot();
  const liveLooms: Record<string, unknown> = {};
  for (const item of snapshot.looms) {
    liveLooms[item.machine_id] = item.liveState;
  }
  return Response.json({
    status: 'ONLINE',
    timestamp: new Date().toISOString(),
    liveLooms,
    ...snapshot,
  });
}

export async function DELETE(req: NextRequest) {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey || !safeEqual(req.headers.get('x-admin-key'), adminKey)) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const targetId = req.nextUrl.searchParams.get('id');
  const clearAll = req.nextUrl.searchParams.get('all') === 'true';

  if (clearAll) {
    clearAllLooms();
    const supabase = getServiceSupabase();
    if (supabase) {
      await supabase.from('loom_live_state').delete().neq('machine_id', '');
    }
    return Response.json({ success: true, cleared: 'ALL' });
  }

  if (targetId) {
    clearTestLoom(targetId);
    const supabase = getServiceSupabase();
    if (supabase) {
      await supabase.from('loom_live_state').delete().eq('machine_id', targetId);
    }
    return Response.json({ success: true, cleared: targetId });
  }

  return Response.json({ success: false, error: 'Missing id or all query parameter' }, { status: 400 });
}
