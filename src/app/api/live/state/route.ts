// src/app/api/live/state/route.ts: Local LAN Telemetry Endpoint
import { NextResponse } from 'next/server';
import { getLocalStoreSnapshot } from '@/lib/localStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = getLocalStoreSnapshot();
  return NextResponse.json(snapshot, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
