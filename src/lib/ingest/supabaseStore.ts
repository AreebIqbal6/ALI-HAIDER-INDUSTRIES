// Supabase-backed IngestStore: device lookup + RPC ingest_message (migration 006).
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PermanentIngestError,
  TransientIngestError,
  type DeviceRecord,
  type IngestStore,
  type StoreStatus,
  type StoredEnvelope,
} from './types';

interface PgErrorLike {
  code?: string;
  message?: string;
}

/** Postgres data/integrity errors (class 22, 23) and RAISE EXCEPTION are message-specific. */
function isPermanent(err: PgErrorLike): boolean {
  const code = err.code ?? '';
  return /^(22|23)/.test(code) || code === 'P0001';
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set(['stored', 'duplicate', 'stale', 'rejected']);

export function createSupabaseIngestStore(client: SupabaseClient): IngestStore {
  return {
    async findDeviceByTokenHash(tokenHash: string): Promise<DeviceRecord | null> {
      const { data, error } = await client
        .from('devices')
        .select('device_id, machine_id, status')
        .eq('token_hash', tokenHash)
        .maybeSingle();
      if (error) throw new TransientIngestError(`device lookup failed: ${error.code ?? ''}`);
      if (!data) return null;
      return { deviceId: data.device_id, machineId: data.machine_id, status: data.status };
    },

    async ingestMessage(env: StoredEnvelope, receivedAt: Date): Promise<StoreStatus> {
      const { data, error } = await client.rpc('ingest_message', {
        p_env: env,
        p_received_at: receivedAt.toISOString(),
      });
      if (error) {
        if (isPermanent(error)) throw new PermanentIngestError(error.code ?? 'data error');
        throw new TransientIngestError(`ingest_message failed: ${error.code ?? ''}`);
      }
      if (typeof data !== 'string' || !KNOWN_STATUSES.has(data)) {
        throw new TransientIngestError('ingest_message returned an unexpected value');
      }
      return data as StoreStatus;
    },
  };
}
