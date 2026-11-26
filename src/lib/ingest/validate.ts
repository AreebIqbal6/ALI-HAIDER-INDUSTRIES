import { EnvelopeSchema, type Envelope } from '@/lib/contract';
import type { DeviceRecord } from './types';

export type ValidationResult =
  | { ok: true; msgId: string; env: Envelope }
  | { ok: false; msgId: string | null; reason: string };

function summariseIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('; ')
    .slice(0, 300);
}

/**
 * Validates one envelope against Data Contract v1 and against the authenticated device
 * (deviceId and machineId must match the registration).
 */
export function validateEnvelope(raw: unknown, device?: DeviceRecord): ValidationResult {
  const rawMsgId =
    raw && typeof raw === 'object' && typeof (raw as { msgId?: unknown }).msgId === 'string'
      ? ((raw as { msgId: string }).msgId).slice(0, 64)
      : null;

  const parsed = EnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, msgId: rawMsgId, reason: `invalid envelope: ${summariseIssues(parsed.error.issues)}` };
  }
  const env = parsed.data;
  if (device) {
    if (env.deviceId !== device.deviceId) {
      return { ok: false, msgId: env.msgId, reason: 'deviceId does not match authenticated device' };
    }
    if (env.machineId !== device.machineId) {
      return { ok: false, msgId: env.msgId, reason: 'machineId does not match device registration' };
    }
  }
  return { ok: true, msgId: env.msgId, env };
}
