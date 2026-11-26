// Legacy ingest (pre-contract WT32 pilot frames + edge-gateway envelopes, x-weavesync-key).
// Enabled ONLY when LEGACY_INGEST_KEY is set. Writes to the local LAN store only —
// it never writes to Supabase (cloud data goes through the contract v1 device-token path).
import { z } from 'zod';
import { autoRegisterLoom, updateLoomTelemetry } from '@/lib/localStore';
import { safeEqual } from './auth';

export const LEGACY_KEY_HEADER = 'x-weavesync-key';

export function isLegacyIngestEnabled(): boolean {
  return Boolean(process.env.LEGACY_INGEST_KEY);
}

/** Constant-time check of the legacy shared key. Always false when LEGACY_INGEST_KEY is unset. */
export function isValidLegacyKey(provided: string | null): boolean {
  const expected = process.env.LEGACY_INGEST_KEY;
  if (!expected) return false;
  return safeEqual(provided, expected);
}

// Bounded in-memory dedup for legacy msgIds (the contract path dedups in the DB).
const recentMsgIds = new Set<string>();
const MAX_MSG_CACHE_SIZE = 10000;
function isInMemoryDuplicate(msgId: string): boolean {
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

const HardwarePinsSchema = z.object({
  piStrt: z.union([z.number(), z.boolean()]),
  piPp: z.union([z.number(), z.boolean()]).optional(),
  piWd: z.union([z.number(), z.boolean()]).optional(),
  piFd: z.union([z.number(), z.boolean()]).optional(),
  piLd: z.union([z.number(), z.boolean()]).optional(),
  rawPinHistory: z.array(z.record(z.string(), z.unknown())).optional(),
});

const DirectHardwarePayloadSchema = z.looseObject({
  deviceId: z.string().min(1).max(64).optional(),
  machineId: z.string().min(1).max(64).optional(),
  rpm: z.number().nonnegative().max(2500).optional(),
  pins: HardwarePinsSchema.optional(),
  rawPins: HardwarePinsSchema.optional(),
  rawPinHistory: z.array(z.record(z.string(), z.unknown())).optional(),
  picksDelta: z.number().int().nonnegative().optional(),
  picksTotal: z.number().int().nonnegative().optional(),
  totalPicks: z.number().int().nonnegative().optional(),
  ip: z.string().max(45).optional(),
  fw: z.string().max(32).optional(),
  firmware: z.string().max(32).optional(),
  msgId: z.string().max(128).optional(),
  seq: z.number().int().nonnegative().optional(),
  ts: z.string().max(64).optional(),
  since: z.string().max(64).optional(),
});

const LegacyEnvelopeSchema = z.object({
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
  data: z.record(z.string(), z.unknown()),
});

const LegacyBatchSchema = z.union([
  z.array(LegacyEnvelopeSchema).max(500),
  z.object({ batch: z.array(LegacyEnvelopeSchema).max(500) }),
  z.object({ envelopes: z.array(LegacyEnvelopeSchema).max(500) }),
  DirectHardwarePayloadSchema,
]);

type Pins = z.infer<typeof HardwarePinsSchema>;
type RawPinHistory = Array<{ pin: string; state: number; ms: number }>;
type StopCat = 'WARP' | 'FILLING' | 'SELVEDGE' | 'OTHER' | null;

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Processes a legacy body; returns [httpStatus, json]. */
export function processLegacyBody(rawBody: unknown): [number, Record<string, unknown>] {
  const parsed = LegacyBatchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return [400, { success: false, error: 'Malformed payload' }];
  }
  const validated = parsed.data;
  const now = new Date().toISOString();

  // Direct WT32-ETH01 single hardware frame
  if (!Array.isArray(validated) && !('batch' in validated) && !('envelopes' in validated)) {
    const hItem = validated as z.infer<typeof DirectHardwarePayloadSchema>;
    const deviceId = hItem.deviceId || 'WT32-ETH01-PILOT';
    const machineId = hItem.machineId || `PIC-${deviceId.slice(-6).replace(/[^A-Za-z0-9]/g, '')}`;
    const msgId = hItem.msgId || `msg-${deviceId}-${hItem.seq ?? Date.now()}`;
    if (isInMemoryDuplicate(msgId)) {
      return [200, { success: true, processed: 0, deduplicated: 1 }];
    }

    const pins: Pins | undefined = hItem.pins || hItem.rawPins;
    if (!pins) {
      return [400, { success: false, error: 'Missing pins' }];
    }
    const isRunning = pins.piStrt === 1 || pins.piStrt === true;
    const rpm = isRunning ? num(hItem.rpm) : 0;

    let detectedCategory: StopCat = null;
    if (!isRunning) {
      if (pins.piFd) detectedCategory = 'FILLING';
      else if (pins.piWd) detectedCategory = 'WARP';
      else if (pins.piLd) detectedCategory = 'SELVEDGE';
      else detectedCategory = 'OTHER';
    }

    autoRegisterLoom({
      deviceId,
      machineId,
      ipAddress: hItem.ip,
      firmwareVersion: hItem.firmware || hItem.fw,
    });

    const history = (Array.isArray(pins.rawPinHistory) ? pins.rawPinHistory : hItem.rawPinHistory) as
      | RawPinHistory
      | undefined;

    updateLoomTelemetry({
      machineId,
      deviceId,
      state: isRunning ? 'RUNNING' : 'STOPPED',
      stopCategory: detectedCategory,
      rpm,
      picksDelta: hItem.picksDelta,
      totalPicks: hItem.totalPicks ?? hItem.picksTotal,
      rawPins: {
        piStrt: Number(pins.piStrt || 0),
        piPp: Number(pins.piPp || 0),
        piWd: Number(pins.piWd || 0),
        piFd: Number(pins.piFd || 0),
        rawPinHistory: history,
      },
      seq: hItem.seq,
      timestamp: hItem.ts || now,
    });

    return [200, {
      success: true,
      mode: 'LOCAL_LAN',
      processed: 1,
      deduplicated: 0,
      machineId,
      status: isRunning ? 'RUNNING' : 'STOPPED',
      stopCategory: detectedCategory,
    }];
  }

  const envelopes = Array.isArray(validated)
    ? validated
    : 'batch' in validated
      ? (validated as { batch: z.infer<typeof LegacyEnvelopeSchema>[] }).batch
      : (validated as { envelopes: z.infer<typeof LegacyEnvelopeSchema>[] }).envelopes;

  let processed = 0;
  let deduplicated = 0;
  for (const env of envelopes) {
    if (isInMemoryDuplicate(env.msgId)) {
      deduplicated++;
      continue;
    }
    const machineId = env.machineId || 'UNKNOWN';
    const deviceId = env.deviceId || `DEV-${machineId}`;
    autoRegisterLoom({ deviceId, machineId });

    const d = env.data as Record<string, unknown>;
    if (env.schema === 'ahi.loom.state/1.0') {
      const state = d.state === 'RUNNING' || d.state === 'STOPPED' || d.state === 'OFFLINE' ? d.state : 'OFFLINE';
      updateLoomTelemetry({
        machineId,
        deviceId,
        state,
        stopCategory: (d.stopCategory as StopCat) || null,
        stopId: (d.stopId as string) || null,
        since: d.since as string | undefined,
        rpm: num(d.rpm),
        totalPicks: typeof d.picksTotal === 'number' ? d.picksTotal : undefined,
        seq: env.seq,
        timestamp: env.ts,
      });
    } else if (env.schema === 'ahi.loom.counters/1.0') {
      const rpmAvg = num(d.rpmAvgRunning);
      updateLoomTelemetry({
        machineId,
        deviceId,
        state: rpmAvg > 0 ? 'RUNNING' : 'STOPPED',
        stopCategory: null,
        rpm: rpmAvg,
        picksDelta: num(d.picksDelta),
        totalPicks: typeof d.picksTotal === 'number' ? d.picksTotal : undefined,
        seq: env.seq,
        timestamp: env.ts,
      });
    }
    processed++;
  }
  return [200, { success: true, processed, deduplicated }];
}
