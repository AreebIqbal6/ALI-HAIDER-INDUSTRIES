// src/app/api/ingest/v1/batch/route.ts: Production IIoT Ingestion Endpoint
// Hardened with Zod validation, constant-time x-weavesync-key authentication,
// rate limiting, replay attack prevention, and dual-mode (Supabase + localStore) transport.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { getServiceSupabase } from '@/lib/supabase';
import { 
  autoRegisterLoom, 
  updateLoomTelemetry, 
  clearTestLoom, 
  clearAllLooms, 
  getLocalStoreSnapshot 
} from '@/lib/localStore';

// In-memory deduplication cache for recent msgIds (bounded to 10,000 entries)
const recentMsgIds = new Set<string>();
const MAX_MSG_CACHE_SIZE = 10000;

function isInMemoryDuplicate(msgId: string): boolean {
  if (recentMsgIds.has(msgId)) {
    return true;
  }
  if (recentMsgIds.size >= MAX_MSG_CACHE_SIZE) {
    // Evict oldest 20%
    const iter = recentMsgIds.values();
    for (let i = 0; i < 2000; i++) {
      const next = iter.next();
      if (next.done) break;
      recentMsgIds.delete(next.value);
    }
  }
  recentMsgIds.add(msgId);
  return false;
}

// In-memory sliding window rate limiter: 120 req / 60s per IP
interface RateLimitRecord {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitRecord>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (!record || now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (record.count >= 120) {
    return false;
  }
  record.count++;
  return true;
}

// Constant-time key comparison
function safeCompareKeys(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// Zod Schema for Direct WT32-ETH01 Hardware Frame
const HardwarePinsSchema = z.object({
  piStrt: z.union([z.number(), z.boolean()]),
  piPp: z.union([z.number(), z.boolean()]).optional(),
  piWd: z.union([z.number(), z.boolean()]).optional(),
  piFd: z.union([z.number(), z.boolean()]).optional(),
  piLd: z.union([z.number(), z.boolean()]).optional(),
  rawPinHistory: z.array(z.record(z.string(), z.any())).optional(),
});

const DirectHardwarePayloadSchema = z.object({
  deviceId: z.string().min(1).max(64).optional(),
  machineId: z.string().min(1).max(64).optional(),
  rpm: z.number().nonnegative().max(2500).optional(),
  pins: HardwarePinsSchema.optional(),
  rawPins: HardwarePinsSchema.optional(),
  rawPinHistory: z.array(z.record(z.string(), z.any())).optional(),
  picksDelta: z.number().int().nonnegative().optional(),
  picksTotal: z.number().int().nonnegative().optional(),
  totalPicks: z.number().int().nonnegative().optional(),
  ip: z.string().max(45).optional(),
  fw: z.string().max(32).optional(),
  firmware: z.string().max(32).optional(),
  msgId: z.string().max(128).optional(),
  seq: z.number().int().nonnegative().optional(),
  ts: z.string().max(64).optional(),
  since: z.string().max(64).optional()
}).passthrough();

// Zod Schema for Canonical Envelopes
const CanonicalEnvelopeSchema = z.object({
  schema: z.string().min(1).max(64),
  msgId: z.string().min(1).max(128),
  seq: z.number().int().nonnegative(),
  machineId: z.string().max(64).nullable().optional(),
  gatewayId: z.string().max(64).optional(),
  source: z.string().max(32).optional(),
  deviceId: z.string().max(64).nullable().optional(),
  ts: z.string().max(64),
  tsQuality: z.enum(['SYNCED', 'ESTIMATED']).optional(),
  replayed: z.boolean().optional(),
  data: z.record(z.string(), z.any())
});

const IngestBatchSchema = z.union([
  z.array(CanonicalEnvelopeSchema).max(500),
  z.object({ batch: z.array(CanonicalEnvelopeSchema).max(500) }),
  z.object({ envelopes: z.array(CanonicalEnvelopeSchema).max(500) }),
  DirectHardwarePayloadSchema
]);

/**
 * GET: Serves live store state snapshot
 * Used by Local LAN mode, health monitoring, and pilot verification
 */
export async function GET() {
  const snapshot = getLocalStoreSnapshot();
  const liveLooms: Record<string, any> = {};
  for (const item of snapshot.looms) {
    liveLooms[item.machine_id] = {
      ...item.liveState,
      state: item.liveState.state,
      stop_category: item.liveState.stop_category,
      rpm: item.liveState.rpm
    };
  }
  return NextResponse.json({
    status: 'ONLINE',
    gatewayId: 'AHI-GW-01',
    timestamp: new Date().toISOString(),
    liveLooms,
    ...snapshot
  });
}

/**
 * POST: Accepts batch telemetry from WT32-ETH01 or Edge Gateway
 */
export async function POST(req: NextRequest) {
  // 1. Rate Limiting
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
  if (!checkRateLimit(clientIp)) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded: max 120 requests/minute' },
      { status: 429 }
    );
  }

  // 2. Authenticate with x-weavesync-key
  const expectedKey = process.env.INGEST_API_KEY || 'weavesync-industrial-secret-2026';
  const providedKey = req.headers.get('x-weavesync-key');

  if (!providedKey || !safeCompareKeys(providedKey, expectedKey)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: Invalid or missing x-weavesync-key header' },
      { status: 401 }
    );
  }

  try {
    const rawBody = await req.json();

    // 3. Validate payload structure with Zod
    const parseResult = IngestBatchSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: 'Malformed payload', details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const validated = parseResult.data;
    const now = new Date().toISOString();
    let processedCount = 0;
    let deduplicatedCount = 0;

    // Handle Direct WT32-ETH01 Single Hardware Frame
    if (!Array.isArray(validated) && !('batch' in validated) && !('envelopes' in validated)) {
      const hItem = validated;
      const deviceId = hItem.deviceId || 'WT32-ETH01-PILOT';
      const machineId = hItem.machineId || `PIC-${deviceId.slice(-6).replace(/[^A-Za-z0-9]/g, '')}`;

      const msgId = hItem.msgId || `msg-${deviceId}-${hItem.seq || Date.now()}`;
      if (isInMemoryDuplicate(msgId)) {
        return NextResponse.json({ success: true, processed: 0, deduplicated: 1 });
      }

      const pins = hItem.pins || hItem.rawPins || { piStrt: 1, piPp: 1 };
      const isRunning = Boolean(pins.piStrt === 1 || pins.piStrt === true);
      const rpm = isRunning ? (hItem.rpm !== undefined ? hItem.rpm : 874) : 0;

      let detectedCategory: 'WARP' | 'FILLING' | 'SELVEDGE' | 'OTHER' | null = null;
      if (!isRunning) {
        if (pins.piFd) detectedCategory = 'FILLING';
        else if (pins.piWd) detectedCategory = 'WARP';
        else if (pins.piLd) detectedCategory = 'SELVEDGE';
        else detectedCategory = 'OTHER';
      }

      // Auto-register and update local store
      autoRegisterLoom({
        deviceId,
        machineId,
        ipAddress: hItem.ip,
        firmwareVersion: hItem.firmware || (hItem as any).fw || 'v2.1'
      });

      const extractedRawPinHistory = Array.isArray(pins.rawPinHistory)
        ? (pins.rawPinHistory as any)
        : (Array.isArray((hItem as any).rawPinHistory) ? (hItem as any).rawPinHistory : undefined);

      updateLoomTelemetry({
        machineId,
        deviceId,
        state: isRunning ? 'RUNNING' : 'STOPPED',
        stopCategory: detectedCategory,
        rpm,
        picksDelta: hItem.picksDelta,
        totalPicks: hItem.totalPicks ?? (hItem as any).picksTotal,
        rawPins: {
          piStrt: Number(pins.piStrt || 0),
          piPp: Number(pins.piPp || 0),
          piWd: Number(pins.piWd || 0),
          piFd: Number(pins.piFd || 0),
          rawPinHistory: extractedRawPinHistory
        },
        seq: hItem.seq,
        timestamp: hItem.ts || now
      });

      // Best-effort write to Supabase (if enabled)
      try {
        const supabase = getServiceSupabase();
        if (supabase) {
          await supabase.from('loom_live_state').upsert({
            machine_id: machineId,
            device_id: deviceId,
            state: isRunning ? 'RUNNING' : 'STOPPED',
            stop_category: detectedCategory,
            rpm,
            last_ts: hItem.ts || now,
            updated_at: now
          }, { onConflict: 'machine_id' });
        }
      } catch (dbErr) {
        // Safe in local LAN mode when Supabase is offline
      }

      return NextResponse.json({
        success: true,
        mode: 'LOCAL_LAN',
        processed: 1,
        deduplicated: 0,
        machineId,
        status: isRunning ? 'RUNNING' : 'STOPPED',
        stopCategory: detectedCategory
      });
    }

    // Handle Canonical Envelope Array
    const envelopes: any[] = Array.isArray(validated)
      ? validated
      : ('batch' in (validated as any) ? (validated as any).batch : (validated as any).envelopes);

    for (const env of envelopes) {
      if (isInMemoryDuplicate(env.msgId)) {
        deduplicatedCount++;
        continue;
      }

      const machineId = env.machineId || 'UNKNOWN';
      const deviceId = env.deviceId || `DEV-${machineId}`;

      autoRegisterLoom({
        deviceId,
        machineId
      });

      if (env.schema === 'ahi.loom.state/1.0') {
        const stateData = env.data as any;
        updateLoomTelemetry({
          machineId,
          deviceId,
          state: stateData.state || 'RUNNING',
          stopCategory: stateData.stopCategory || null,
          stopId: stateData.stopId || null,
          since: stateData.since,
          rpm: stateData.rpm || 0,
          seq: env.seq,
          timestamp: env.ts
        });
      } else if (env.schema === 'ahi.loom.counters/1.0') {
        const cntData = env.data as any;
        updateLoomTelemetry({
          machineId,
          deviceId,
          state: cntData.rpmAvgRunning > 0 ? 'RUNNING' : 'STOPPED',
          stopCategory: null,
          rpm: cntData.rpmAvgRunning || 0,
          picksDelta: cntData.picksDelta || 0,
          totalPicks: cntData.picksTotal,
          seq: env.seq,
          timestamp: env.ts
        });
      }

      processedCount++;
    }

    return NextResponse.json({
      success: true,
      processed: processedCount,
      deduplicated: deduplicatedCount
    });

  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: 'Internal ingestion error', message: err.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE: Clean up test machines for external verification
 */
export async function DELETE(req: NextRequest) {
  const expectedKey = process.env.INGEST_API_KEY || 'weavesync-industrial-secret-2026';
  const providedKey = req.headers.get('x-weavesync-key');

  if (!providedKey || !safeCompareKeys(providedKey, expectedKey)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const targetId = searchParams.get('id');
  const clearAll = searchParams.get('all') === 'true';

  if (clearAll) {
    clearAllLooms();
    try {
      const supabase = getServiceSupabase();
      if (supabase) {
        await supabase.from('loom_live_state').delete().neq('machine_id', '');
      }
    } catch {}
    return NextResponse.json({ success: true, cleared: 'ALL' });
  }

  if (targetId) {
    clearTestLoom(targetId);
    try {
      const supabase = getServiceSupabase();
      if (supabase) {
        await supabase.from('loom_live_state').delete().eq('machine_id', targetId);
      }
    } catch {}
    return NextResponse.json({ success: true, cleared: targetId });
  }

  return NextResponse.json({ success: false, error: 'Missing id or all query parameter' }, { status: 400 });
}
