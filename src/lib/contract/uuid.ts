// UUID helpers for Data Contract v1 (msgId / stopId are UUIDv7, RFC 9562).
import { randomBytes } from 'crypto';

const UUID_ANY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// version nibble = 7, variant bits = 10xx (8, 9, a, b)
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_ANY_RE.test(value);
}

export function isUuidV7(value: unknown): value is string {
  return typeof value === 'string' && UUID_V7_RE.test(value);
}

/** Unix epoch milliseconds encoded in the first 48 bits of a UUIDv7. */
export function uuidV7Timestamp(value: string): number | null {
  if (!isUuidV7(value)) return null;
  const hex = value.replace(/-/g, '').slice(0, 12);
  return parseInt(hex, 16);
}

let lastMs = -1;
let counter = 0;

/**
 * RFC 9562 UUIDv7: 48-bit unix ms timestamp, version 7, 12-bit rand_a used as a
 * monotonic counter within the same millisecond, variant 0b10, 62 random bits.
 */
export function generateUuidV7(nowMs: number = Date.now()): string {
  const bytes = randomBytes(16);
  let ms = Math.max(0, Math.floor(nowMs));
  if (ms <= lastMs) {
    counter++;
    if (counter > 0xfff) {
      // counter overflow: borrow the next millisecond to stay monotonic
      lastMs++;
      counter = 0;
    }
    ms = lastMs;
  } else {
    lastMs = ms;
    counter = bytes[6] & 0x07; // random start, leaves headroom for increments
  }

  // 48-bit big-endian timestamp
  bytes[0] = Math.floor(ms / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ms / 2 ** 32) & 0xff;
  bytes[2] = (ms >>> 24) & 0xff;
  bytes[3] = (ms >>> 16) & 0xff;
  bytes[4] = (ms >>> 8) & 0xff;
  bytes[5] = ms & 0xff;
  // version 7 + 12-bit counter (rand_a)
  bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  // variant 10xxxxxx
  bytes[8] = 0x80 | (bytes[8] & 0x3f);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
