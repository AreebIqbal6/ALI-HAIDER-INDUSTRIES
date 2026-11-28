import { describe, expect, it } from 'vitest';
import { getActiveShiftInfo } from '@/contexts/TelemetryContext';

describe('getActiveShiftInfo (Asia/Karachi UTC+5 12h shifts)', () => {
  it('computes Shift A (08:00-20:00 PKT) accurately', () => {
    // 10:00 PKT = 05:00 UTC
    const now = new Date('2026-11-28T05:00:00.000Z');
    const info = getActiveShiftInfo(now);
    expect(info.type).toBe('SHIFT_A');
    expect(info.startTimeUtc).toBe('2026-11-28T03:00:00.000Z');
    expect(info.endTimeUtc).toBe('2026-11-28T15:00:00.000Z');
    expect(info.elapsedMs).toBe(2 * 3600 * 1000);
  });

  it('computes Shift B before midnight PKT (20:00-23:59 PKT)', () => {
    // 22:00 PKT on Nov 28 = 17:00 UTC on Nov 28
    const now = new Date('2026-11-28T17:00:00.000Z');
    const info = getActiveShiftInfo(now);
    expect(info.type).toBe('SHIFT_B');
    expect(info.startTimeUtc).toBe('2026-11-28T15:00:00.000Z');
    expect(info.endTimeUtc).toBe('2026-11-29T03:00:00.000Z');
    expect(info.elapsedMs).toBe(2 * 3600 * 1000);
  });

  it('computes Shift B after midnight PKT (00:00-07:59 PKT) anchored to yesterday 20:00 PKT', () => {
    // 02:00 PKT on Nov 29 = 21:00 UTC on Nov 28
    const now = new Date('2026-11-28T21:00:00.000Z');
    const info = getActiveShiftInfo(now);
    expect(info.type).toBe('SHIFT_B');
    expect(info.startTimeUtc).toBe('2026-11-28T15:00:00.000Z');
    expect(info.endTimeUtc).toBe('2026-11-29T03:00:00.000Z');
    expect(info.elapsedMs).toBe(6 * 3600 * 1000);
  });
});
