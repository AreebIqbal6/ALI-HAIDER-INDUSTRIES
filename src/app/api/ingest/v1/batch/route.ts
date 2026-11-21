// src/app/api/ingest/v1/batch/route.ts: Production IIoT Ingestion Endpoint
// Hardened with Zod validation, x-weavesync-key authentication, auto-registration, and localStore fallback.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceSupabase } from '@/lib/supabase';
import { autoRegisterLoom, updateLoomTelemetry, clearTestLoom } from '@/lib/localStore';

// In-memory deduplication cache for recent msgIds (bounded to 10,000 entries)
const recentMsgIds = new Set<string>();
const MAX_MSG_CACHE_SIZE = 10000;

function isDuplicate(msgId: string): boolean {
  if (recentMsgIds.has(msgId)) return true;
  if (recentMsgIds.size >= MAX_MSG_CACHE_SIZE) {
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

// Zod Schema for Direct WT32-ETH01 Hardware Frame
const HardwarePinsSchema = z.object({
  piStrt: z.union([z.number(), z.boolean()]),
  piPp: z.union([z.number(), z.boolean()]).optional(),
  piWd: z.union([z.number(), z.boolean()]).optional(),
  piFd: z.union([z.number(), z.boolean()]).optional(),
  piLd: z.union([z.number(), z.boolean()]).optional(),
});

const HardwareFrameSchema = z.object({
  deviceId: z.string().min(1).max(50),
  machineId: z.string().min(1).max(50).optional(),
  ip: z.string().optional(),
  fw: z.string().optional(),
  ts: z.string().optional(),
  seq: z.number().optional(),
  pins: HardwarePinsSchema.optional(),
  rawPins: HardwarePinsSchema.optional(),
  picksDelta: z.number().nonnegative().optional(),
  picksTotal: z.number().nonnegative().optional(),
  rpm: z.number().nonnegative().optional(),
  stopId: z.string().optional(),
  since: z.string().optional(),
  rawPinHistory: z.array(z.any()).optional(),
});

// Zod Schema for Canonical Envelopes
const CanonicalEnvelopeSchema = z.object({
  schema: z.string().min(1),
  msgId: z.string().min(1),
  seq: z.number().optional(),
  machineId: z.string().min(1),
  gatewayId: z.string().optional(),
  source: z.string().optional(),
  deviceId: z.string().optional(),
  ts: z.string().min(1),
  tsQuality: z.string().optional(),
  replayed: z.boolean().optional(),
  data: z.record(z.string(), z.any()),
});

const IngestBatchSchema = z.union([
  HardwareFrameSchema,
  CanonicalEnvelopeSchema,
  z.array(z.union([HardwareFrameSchema, CanonicalEnvelopeSchema])),
  z.object({
    batch: z.array(z.union([HardwareFrameSchema, CanonicalEnvelopeSchema])),
  }),
  z.object({
    envelopes: z.array(z.union([HardwareFrameSchema, CanonicalEnvelopeSchema])),
  }),
]);

export async function POST(req: NextRequest) {
  // 1. Authenticate with x-weavesync-key
  const expectedKey = process.env.INGEST_API_KEY || 'weavesync-industrial-secret-2026';
  const providedKey = req.headers.get('x-weavesync-key');

  if (!providedKey || providedKey !== expectedKey) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: Missing or invalid x-weavesync-key header' },
      { status: 401 }
    );
  }

  try {
    const rawBody = await req.json();

    // 2. Validate payload structure with Zod
    const parseResult = IngestBatchSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Malformed ingestion payload',
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    // Unify payload into an array of items
    let items: Array<z.infer<typeof HardwareFrameSchema> | z.infer<typeof CanonicalEnvelopeSchema>> = [];
    const parsed = parseResult.data;

    if (Array.isArray(parsed)) {
      items = parsed;
    } else if ('batch' in parsed && Array.isArray(parsed.batch)) {
      items = parsed.batch;
    } else if ('envelopes' in parsed && Array.isArray(parsed.envelopes)) {
      items = parsed.envelopes;
    } else {
      items = [parsed as any];
    }

    if (items.length === 0) {
      return NextResponse.json({ success: false, error: 'Empty batch payload' }, { status: 400 });
    }

    if (items.length > 500) {
      return NextResponse.json(
        { success: false, error: `Batch size ${items.length} exceeds maximum limit of 500 items` },
        { status: 400 }
      );
    }

    const supabase = getServiceSupabase();
    let processedCount = 0;
    let deduplicatedCount = 0;
    const errors: string[] = [];

    for (const item of items) {
      const nowIso = new Date().toISOString();

      // Case A: Direct WT32-ETH01 hardware frame
      if ('pins' in item || 'rawPins' in item || 'deviceId' in item) {
        const hItem = item as z.infer<typeof HardwareFrameSchema>;
        const deviceId = hItem.deviceId;
        const machineId = hItem.machineId || `LOOM-${deviceId.replace(/[^a-zA-Z0-9]/g, '').slice(-6)}`;
        const pins = hItem.pins || hItem.rawPins || { piStrt: 0 };
        const isRunning = pins.piStrt === 1 || pins.piStrt === true;

        let detectedCategory: 'WARP' | 'FILLING' | 'SELVEDGE' | 'OTHER' | null = null;
        if (!isRunning) {
          if (pins.piFd) detectedCategory = 'FILLING';
          else if (pins.piWd) detectedCategory = 'WARP';
          else if (pins.piLd) detectedCategory = 'SELVEDGE';
          else detectedCategory = 'OTHER';
        }

        // Auto-register device in localStore
        autoRegisterLoom({
          deviceId,
          machineId,
          ipAddress: hItem.ip,
          firmwareVersion: hItem.fw,
        });

        // Update localStore live telemetry
        updateLoomTelemetry({
          machineId,
          deviceId,
          isRunning,
          stopCategory: detectedCategory,
          stopId: hItem.stopId,
          rpm: hItem.rpm,
          picksDelta: hItem.picksDelta || 0,
          seq: hItem.seq,
          ts: hItem.ts || nowIso,
          rawPins: {
            piStrt: Number(pins.piStrt),
            piPp: Number(pins.piPp || 0),
            piWd: Number(pins.piWd || 0),
            piFd: Number(pins.piFd || 0),
            rawPinHistory: hItem.rawPinHistory,
          },
        });

        processedCount++;

        // Persist to Supabase if reachable
        try {
          await supabase.from('looms').upsert(
            {
              machine_id: machineId,
              device_id: deviceId,
              ip_address: hItem.ip || null,
              firmware_version: hItem.fw || 'v2.1-pilot',
              status: isRunning ? 'RUNNING' : 'STOPPED',
              last_heartbeat_at: nowIso,
            },
            { onConflict: 'machine_id' }
          );

          await supabase.from('loom_live_state').upsert(
            {
              machine_id: machineId,
              device_id: deviceId,
              state: isRunning ? 'RUNNING' : 'STOPPED',
              stop_category: detectedCategory,
              stop_id: isRunning ? null : (hItem.stopId || `stop-${Date.now()}`),
              since: hItem.since || nowIso,
              rpm: isRunning ? (hItem.rpm || 874) : 0,
              raw_pins: {
                piStrt: Number(pins.piStrt),
                piPp: Number(pins.piPp || 0),
                piWd: Number(pins.piWd || 0),
                piFd: Number(pins.piFd || 0),
                rawPinHistory: hItem.rawPinHistory,
              },
              last_ts: nowIso,
              updated_at: nowIso,
            },
            { onConflict: 'machine_id' }
          );
        } catch (dbErr: any) {
          // Graceful fallback in local LAN mode
        }
      }
      // Case B: Canonical Envelope
      else if ('schema' in item && 'msgId' in item) {
        const env = item as z.infer<typeof CanonicalEnvelopeSchema>;
        if (isDuplicate(env.msgId)) {
          deduplicatedCount++;
          continue;
        }

        const machineId = env.machineId;
        const deviceId = env.deviceId || `DEV-${machineId}`;

        // Auto-register
        autoRegisterLoom({
          deviceId,
          machineId,
        });

        if (env.schema === 'ahi.loom.state/1.0') {
          const data = env.data as any;
          const isRunning = data.state === 'RUNNING';

          updateLoomTelemetry({
            machineId,
            deviceId,
            isRunning,
            stopCategory: data.stopCategory,
            stopId: data.stopId,
            rpm: data.rpm,
            ts: env.ts,
          });

          try {
            await supabase.from('looms').upsert(
              {
                machine_id: machineId,
                device_id: deviceId,
                status: isRunning ? 'RUNNING' : 'STOPPED',
                last_heartbeat_at: env.ts,
              },
              { onConflict: 'machine_id' }
            );

            await supabase.from('loom_live_state').upsert(
              {
                machine_id: machineId,
                device_id: deviceId,
                state: data.state,
                stop_category: data.stopCategory || null,
                stop_id: data.stopId || null,
                since: data.since || env.ts,
                rpm: data.rpm || 0,
                last_ts: env.ts,
                replayed: env.replayed || false,
                updated_at: nowIso,
              },
              { onConflict: 'machine_id' }
            );
          } catch (dbErr) {
            // Local LAN mode
          }
        }

        processedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      received: items.length,
      processed: processedCount,
      deduplicated: deduplicatedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error('Fatal ingest error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE method for testing and cleanup
export async function DELETE(req: NextRequest) {
  const expectedKey = process.env.INGEST_API_KEY || 'weavesync-industrial-secret-2026';
  const providedKey = req.headers.get('x-weavesync-key');

  if (!providedKey || providedKey !== expectedKey) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const targetId = searchParams.get('id');

  if (targetId) {
    clearTestLoom(targetId);
    try {
      const supabase = getServiceSupabase();
      await supabase.from('looms').delete().or(`machine_id.eq.${targetId},device_id.eq.${targetId}`);
    } catch (e) {}
  }

  return NextResponse.json({ success: true, cleared: targetId });
}
