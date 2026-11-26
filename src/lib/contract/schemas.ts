// Zod 4 schemas for Data Contract v1 (see contract/v1/README.md + examples).
// The golden examples in contract/v1/examples must validate unchanged.
import { z } from 'zod';
import { isUuid, isUuidV7 } from './uuid';
import { isIsoUtcZ } from './time';

export const MAX_ENVELOPES_PER_BATCH = 50;

export const SCHEMA_STATE = 'ahi.loom.state/1.0' as const;
export const SCHEMA_EVENT = 'ahi.loom.event/1.0' as const;
export const SCHEMA_COUNTERS = 'ahi.loom.counters/1.0' as const;
export const SCHEMA_HEALTH = 'ahi.device.health/1.0' as const;
export const CONTRACT_SCHEMAS = [SCHEMA_STATE, SCHEMA_EVENT, SCHEMA_COUNTERS, SCHEMA_HEALTH] as const;

export const uuidV7String = z.string().refine(isUuidV7, { message: 'must be a UUIDv7' });
export const uuidString = z.string().refine(isUuid, { message: 'must be a UUID' });
export const isoZString = z.string().refine(isIsoUtcZ, { message: 'must be ISO-8601 UTC ending in Z' });

const nonNegInt = z.number().int().nonnegative();
const shortText = (max: number) => z.string().max(max);

export const StopCategorySchema = z.enum(['WARP', 'FILLING', 'SELVEDGE', 'OTHER']);
export const LoomStateSchema = z.enum(['RUNNING', 'STOPPED', 'OFFLINE', 'UNKNOWN']);
export const TsQualitySchema = z.enum(['SYNCED', 'ESTIMATED']);
export const EventTypeSchema = z.enum([
  'STOP_STARTED',
  'STOP_ENDED',
  'START_ATTEMPT_FAILED',
  'COUNTER_DISCONTINUITY',
]);

// ---- data payloads ----------------------------------------------------------

export const StateDataSchema = z.object({
  state: LoomStateSchema,
  stopCategory: StopCategorySchema.nullable(),
  stopId: uuidString.nullable(),
  since: isoZString,
  rpm: z.number().nonnegative().max(5000),
  picksTotal: nonNegInt,
});

export const EventDataSchema = z.object({
  eventType: EventTypeSchema,
  stopId: uuidString.nullable().optional(),
  stopCategory: StopCategorySchema.nullable().optional(),
  detectedAt: isoZString.nullable().optional(),
  durationMs: nonNegInt.nullable().optional(),
  failedStartAttempts: nonNegInt.nullable().optional(),
  picksTotal: nonNegInt.nullable().optional(),
  // Sent by firmware ldl-wt32: START_ATTEMPT_FAILED and COUNTER_DISCONTINUITY details.
  attempt: nonNegInt.nullable().optional(),
  picksInAttempt: nonNegInt.nullable().optional(),
  reason: z.string().max(64).nullable().optional(),
});

export const CountersDataSchema = z.object({
  windowStart: isoZString,
  windowEnd: isoZString,
  picksDelta: nonNegInt,
  picksTotal: nonNegInt,
  runMs: nonNegInt,
  stopMs: nonNegInt,
  offlineMs: nonNegInt,
  stops: z.object({
    WARP: nonNegInt,
    FILLING: nonNegInt,
    SELVEDGE: nonNegInt,
    OTHER: nonNegInt,
  }),
  rpmAvgRunning: z.number().nonnegative().max(5000),
}).refine((d) => Date.parse(d.windowEnd) > Date.parse(d.windowStart), {
  message: 'windowEnd must be after windowStart',
  path: ['windowEnd'],
});

export const HealthDataSchema = z.object({
  status: shortText(32).min(1),
  ipAddress: shortText(45).nullable().optional(),
  firmwareVersion: shortText(64).nullable().optional(),
  uptimeSeconds: nonNegInt,
  lastError: shortText(512).nullable().optional(),
  bootId: nonNegInt,
  bufferType: shortText(32).min(1),
  bufferBacklog: nonNegInt,
  clockSynced: z.boolean(),
  linkUp: z.boolean(),
});

// ---- envelope ----------------------------------------------------------------

const envelopeBase = {
  msgId: uuidV7String,
  seq: z.number().int().min(1),
  bootId: nonNegInt,
  deviceId: shortText(64).min(1),
  machineId: z.string().regex(/^PIC-[A-Za-z0-9]{1,32}$/, 'must be PIC-<serial>'),
  gatewayId: shortText(64).min(1),
  source: z.literal('LDL'),
  ts: isoZString,
  tsQuality: TsQualitySchema,
  replayed: z.boolean(),
};

export const StateEnvelopeSchema = z.object({
  schema: z.literal(SCHEMA_STATE),
  ...envelopeBase,
  data: StateDataSchema,
});
export const EventEnvelopeSchema = z.object({
  schema: z.literal(SCHEMA_EVENT),
  ...envelopeBase,
  data: EventDataSchema,
});
export const CountersEnvelopeSchema = z.object({
  schema: z.literal(SCHEMA_COUNTERS),
  ...envelopeBase,
  data: CountersDataSchema,
});
export const HealthEnvelopeSchema = z.object({
  schema: z.literal(SCHEMA_HEALTH),
  ...envelopeBase,
  data: HealthDataSchema,
});

export const EnvelopeSchema = z.discriminatedUnion('schema', [
  StateEnvelopeSchema,
  EventEnvelopeSchema,
  CountersEnvelopeSchema,
  HealthEnvelopeSchema,
]);

// ---- batch request / response -------------------------------------------------

/** Outer shape only; envelopes are validated one by one so one bad item cannot sink the batch. */
export const BatchRequestShellSchema = z.object({
  deviceId: shortText(64).min(1),
  envelopes: z.array(z.unknown()),
});

export const BatchRequestSchema = z.object({
  deviceId: shortText(64).min(1),
  envelopes: z.array(EnvelopeSchema).max(MAX_ENVELOPES_PER_BATCH),
});

export const ResultStatusSchema = z.enum(['stored', 'duplicate', 'rejected']);

export const BatchResponseSchema = z.object({
  serverTime: isoZString,
  results: z.array(
    z.object({
      msgId: z.string().nullable(),
      status: ResultStatusSchema,
      reason: z.string().optional(),
    }),
  ),
});

export type ContractSchema = (typeof CONTRACT_SCHEMAS)[number];
export type Envelope = z.infer<typeof EnvelopeSchema>;
export type StateEnvelope = z.infer<typeof StateEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
export type CountersEnvelope = z.infer<typeof CountersEnvelopeSchema>;
export type HealthEnvelope = z.infer<typeof HealthEnvelopeSchema>;
export type ContractStateData = z.infer<typeof StateDataSchema>;
export type ContractEventData = z.infer<typeof EventDataSchema>;
export type ContractCountersData = z.infer<typeof CountersDataSchema>;
export type ContractHealthData = z.infer<typeof HealthDataSchema>;
export type BatchRequest = z.infer<typeof BatchRequestSchema>;
export type BatchResponse = z.infer<typeof BatchResponseSchema>;
export type BatchResultStatus = z.infer<typeof ResultStatusSchema>;
export type BatchResult = BatchResponse['results'][number];
