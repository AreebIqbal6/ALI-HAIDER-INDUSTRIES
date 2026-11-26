// Timestamp rules for Data Contract v1.

// ISO-8601 UTC, 'Z' suffix required, optional fractional seconds (contract sends ms).
const ISO_Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

export function isIsoUtcZ(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_Z_RE.test(value)) return false;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return false;
  // Reject rollover dates such as 2026-02-31 that Date.parse silently normalises.
  return new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19);
}

/** A device timestamp further than this into the future is treated as a bad clock. */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export interface SkewResult {
  /** true when ts is more than MAX_FUTURE_SKEW_MS ahead of the server receive time */
  skewed: boolean;
  /** tsQuality to store: forced to 'ESTIMATED' when skewed */
  tsQuality: 'SYNCED' | 'ESTIMATED';
  /** timestamp to use for ordering/liveness: received_at when skewed, else the device ts */
  effectiveTs: string;
}

/**
 * Skew rule: a ts more than 5 minutes in the future is not trusted. The message is
 * still stored (with its original ts), but marked ESTIMATED and the server receive
 * time is used for liveness/ordering so one bad clock cannot freeze the live state.
 */
export function applySkewRule(
  ts: string,
  tsQuality: 'SYNCED' | 'ESTIMATED',
  receivedAt: Date,
  maxFutureMs: number = MAX_FUTURE_SKEW_MS,
): SkewResult {
  const tsMs = Date.parse(ts);
  const skewed = Number.isNaN(tsMs) || tsMs - receivedAt.getTime() > maxFutureMs;
  return {
    skewed,
    tsQuality: skewed ? 'ESTIMATED' : tsQuality,
    effectiveTs: skewed ? receivedAt.toISOString() : ts,
  };
}
