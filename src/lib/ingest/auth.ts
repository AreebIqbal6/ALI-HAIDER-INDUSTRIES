import { createHash, timingSafeEqual } from 'crypto';
import type { DeviceRecord, IngestStore } from './types';

/** SHA-256 hex of a device token. The database stores only this hash. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Extracts the token from `Authorization: Bearer <token>`; null when absent/malformed. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return null;
  const token = match[1];
  if (token.length < 16 || token.length > 256) return null;
  return token;
}

export type AuthResult =
  | { ok: true; device: DeviceRecord }
  | { ok: false; reason: 'missing_token' | 'unknown_token' | 'inactive_device' | 'device_mismatch' };

/**
 * Token -> SHA-256 -> devices row. The device must be active and the deviceId in the
 * request body must match the registered device for that token.
 */
export async function authenticateDevice(
  store: IngestStore,
  token: string | null,
  bodyDeviceId: string,
): Promise<AuthResult> {
  if (!token) return { ok: false, reason: 'missing_token' };
  const device = await store.findDeviceByTokenHash(hashToken(token));
  if (!device) return { ok: false, reason: 'unknown_token' };
  if (device.status !== 'active') return { ok: false, reason: 'inactive_device' };
  if (device.deviceId !== bodyDeviceId) return { ok: false, reason: 'device_mismatch' };
  return { ok: true, device };
}

/** Constant-time string comparison for shared secrets (legacy/admin keys). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
