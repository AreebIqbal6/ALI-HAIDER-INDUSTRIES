import { describe, it, expect } from 'vitest';
import { EventDataSchema } from '../src/lib/contract/schemas';

// Shapes emitted by firmware/ldl-wt32 for events that have no golden example.
describe('firmware event shapes', () => {
  it('keeps START_ATTEMPT_FAILED details', () => {
    const d = EventDataSchema.parse({
      eventType: 'START_ATTEMPT_FAILED',
      stopId: '0193c8a2-5f0f-7c11-8a22-3b4c5d6e7f80',
      stopCategory: 'OTHER',
      detectedAt: '2026-11-26T09:20:00.000Z',
      attempt: 2,
      picksInAttempt: 3,
      picksTotal: 1535100,
    });
    expect(d.attempt).toBe(2);
    expect(d.picksInAttempt).toBe(3);
  });

  it('keeps COUNTER_DISCONTINUITY reason', () => {
    const d = EventDataSchema.parse({
      eventType: 'COUNTER_DISCONTINUITY',
      detectedAt: '2026-11-26T09:20:00.000Z',
      reason: 'COUNTERS_LOST',
      picksTotal: 0,
    });
    expect(d.reason).toBe('COUNTERS_LOST');
  });
});
