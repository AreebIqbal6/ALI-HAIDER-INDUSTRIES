import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  BatchRequestSchema,
  BatchResponseSchema,
  EnvelopeSchema,
  applySkewRule,
  generateUuidV7,
  isIsoUtcZ,
  isUuidV7,
  uuidV7Timestamp,
} from '@/lib/contract';

const EXAMPLES = path.resolve(__dirname, '..', 'contract', 'v1', 'examples');
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(EXAMPLES, name), 'utf8'));
const ENVELOPE_FILES = ['state.json', 'event_stop_started.json', 'event_stop_ended.json', 'counters.json', 'health.json'];

describe('golden examples (contract/v1/examples)', () => {
  it.each(ENVELOPE_FILES)('%s is a valid envelope', (file) => {
    const r = EnvelopeSchema.safeParse(load(file));
    expect(r.success, JSON.stringify(!r.success && r.error.issues)).toBe(true);
  });

  it('batch_request.json is a valid batch', () => {
    const r = BatchRequestSchema.safeParse(load('batch_request.json'));
    expect(r.success).toBe(true);
  });

  it('batch_response.json is a valid response', () => {
    const r = BatchResponseSchema.safeParse(load('batch_response.json'));
    expect(r.success).toBe(true);
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form mutation of JSON fixtures
type Mutator = (e: Record<string, any>) => void;
const invalid: [string, string, Mutator][] = [
  ['state.json', 'unknown schema', (e) => { e.schema = 'ahi.loom.state/2.0'; }],
  ['state.json', 'msgId is UUIDv4', (e) => { e.msgId = '9b2f7c1e-4a3d-4b6e-8c1f-2d3e4f5a6b7c'; }],
  ['state.json', 'msgId not a uuid', (e) => { e.msgId = 'msg-123'; }],
  ['state.json', 'seq 0', (e) => { e.seq = 0; }],
  ['state.json', 'seq fractional', (e) => { e.seq = 1.5; }],
  ['state.json', 'bootId negative', (e) => { e.bootId = -1; }],
  ['state.json', 'machineId not PIC-', (e) => { e.machineId = 'LOOM-1'; }],
  ['state.json', 'source not LDL', (e) => { e.source = 'WT32-ETH01'; }],
  ['state.json', 'ts without Z', (e) => { e.ts = '2026-11-26T09:15:02.481+05:00'; }],
  ['state.json', 'ts not a date', (e) => { e.ts = '2026-02-31T09:15:02.481Z'; }],
  ['state.json', 'tsQuality invalid', (e) => { e.tsQuality = 'GPS'; }],
  ['state.json', 'replayed missing', (e) => { delete e.replayed; }],
  ['state.json', 'deviceId missing', (e) => { delete e.deviceId; }],
  ['state.json', 'state invalid', (e) => { e.data.state = 'WEAVING'; }],
  ['state.json', 'stopCategory invalid', (e) => { e.data.stopCategory = 'BEAM'; }],
  ['state.json', 'rpm negative', (e) => { e.data.rpm = -5; }],
  ['state.json', 'picksTotal missing', (e) => { delete e.data.picksTotal; }],
  ['event_stop_started.json', 'eventType invalid', (e) => { e.data.eventType = 'STOP_PAUSED'; }],
  ['event_stop_started.json', 'stopId not uuid', (e) => { e.data.stopId = 'stop-1'; }],
  ['event_stop_ended.json', 'durationMs negative', (e) => { e.data.durationMs = -1; }],
  ['counters.json', 'stops missing FILLING', (e) => { delete e.data.stops.FILLING; }],
  ['counters.json', 'windowEnd before windowStart', (e) => { e.data.windowEnd = '2026-11-26T09:15:00.000Z'; }],
  ['counters.json', 'picksDelta string', (e) => { e.data.picksDelta = '812'; }],
  ['health.json', 'clockSynced missing', (e) => { delete e.data.clockSynced; }],
  ['health.json', 'bufferBacklog negative', (e) => { e.data.bufferBacklog = -3; }],
  ['health.json', 'data of the wrong schema', (e) => { e.data = load('state.json').data; }],
];

describe('mutated envelopes are rejected', () => {
  it.each(invalid)('%s: %s', (file, _name, mutate) => {
    const env = load(file);
    mutate(env);
    expect(EnvelopeSchema.safeParse(env).success).toBe(false);
  });

  it('batch with 51 envelopes is rejected', () => {
    const one = load('state.json');
    const r = BatchRequestSchema.safeParse({ deviceId: one.deviceId, envelopes: Array(51).fill(one) });
    expect(r.success).toBe(false);
  });
});

describe('optional event fields', () => {
  it('accepts START_ATTEMPT_FAILED and COUNTER_DISCONTINUITY with minimal data', () => {
    const base = load('event_stop_started.json');
    for (const eventType of ['START_ATTEMPT_FAILED', 'COUNTER_DISCONTINUITY']) {
      expect(EnvelopeSchema.safeParse({ ...base, data: { eventType } }).success).toBe(true);
    }
  });
});

describe('UUIDv7', () => {
  it('validates v7 and rejects other versions/variants', () => {
    expect(isUuidV7('0193c8a2-5f10-7a3b-9c4d-1a2b3c4d5e01')).toBe(true);
    expect(isUuidV7('0193C8A2-5F10-7A3B-9C4D-1A2B3C4D5E01')).toBe(true);
    expect(isUuidV7('0193c8a2-5f10-4a3b-9c4d-1a2b3c4d5e01')).toBe(false); // v4
    expect(isUuidV7('0193c8a2-5f10-7a3b-cc4d-1a2b3c4d5e01')).toBe(false); // bad variant
    expect(isUuidV7('0193c8a25f107a3b9c4d1a2b3c4d5e01')).toBe(false); // no dashes
    expect(isUuidV7(42)).toBe(false);
  });

  it('generates valid, time-ordered, unique v7 ids', () => {
    const t = Date.UTC(2026, 10, 26, 9, 0, 0);
    const ids = Array.from({ length: 2000 }, () => generateUuidV7(t));
    expect(ids.every(isUuidV7)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids); // monotonic within the same millisecond
    expect(uuidV7Timestamp(generateUuidV7(t + 10_000))).toBeGreaterThanOrEqual(t + 10_000);
  });
});

describe('ISO-Z timestamps', () => {
  it('requires UTC Z', () => {
    expect(isIsoUtcZ('2026-11-26T09:15:02.481Z')).toBe(true);
    expect(isIsoUtcZ('2026-11-26T09:15:02Z')).toBe(true);
    expect(isIsoUtcZ('2026-11-26T09:15:02.481')).toBe(false);
    expect(isIsoUtcZ('2026-11-26 09:15:02Z')).toBe(false);
    expect(isIsoUtcZ('2026-13-01T00:00:00Z')).toBe(false);
  });
});

describe('skew rule', () => {
  const received = new Date('2026-11-26T09:00:00.000Z');
  it('keeps SYNCED ts up to 5 minutes ahead', () => {
    const r = applySkewRule('2026-11-26T09:04:59.000Z', 'SYNCED', received);
    expect(r).toEqual({ skewed: false, tsQuality: 'SYNCED', effectiveTs: '2026-11-26T09:04:59.000Z' });
  });
  it('past timestamps (buffered replay) are not skewed', () => {
    expect(applySkewRule('2026-11-25T09:00:00.000Z', 'SYNCED', received).skewed).toBe(false);
  });
  it('ts more than 5 minutes ahead => ESTIMATED and received_at for liveness', () => {
    const r = applySkewRule('2026-11-26T09:05:01.000Z', 'SYNCED', received);
    expect(r).toEqual({ skewed: true, tsQuality: 'ESTIMATED', effectiveTs: received.toISOString() });
  });
});
