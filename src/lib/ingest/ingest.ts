import { applySkewRule, type BatchResultStatus, type Envelope } from '@/lib/contract';
import { PermanentIngestError, type IngestStore, type StoreStatus } from './types';

export interface IngestOutcome {
  /** status reported to the device ('stale' is reported as 'stored': it is in history) */
  status: BatchResultStatus;
  /** internal status from the store, for logging/tests */
  storeStatus: StoreStatus;
  reason?: string;
}

export function mapStoreStatus(s: StoreStatus): BatchResultStatus {
  switch (s) {
    case 'stored':
    case 'stale':
      return 'stored';
    case 'duplicate':
      return 'duplicate';
    default:
      return 'rejected';
  }
}

/**
 * Applies the skew rule and hands one validated envelope to the store
 * (Supabase RPC ingest_message). TransientIngestError propagates to the caller.
 */
export async function ingestEnvelope(
  store: IngestStore,
  env: Envelope,
  receivedAt: Date,
): Promise<IngestOutcome> {
  const skew = applySkewRule(env.ts, env.tsQuality, receivedAt);
  const normalised = skew.skewed ? { ...env, tsQuality: skew.tsQuality, clockSkewed: true } : env;
  try {
    const storeStatus = await store.ingestMessage(normalised, receivedAt);
    const status = mapStoreStatus(storeStatus);
    return status === 'rejected'
      ? { status, storeStatus, reason: 'rejected by store (device/machine not registered or unsupported message)' }
      : { status, storeStatus };
  } catch (err) {
    if (err instanceof PermanentIngestError) {
      return { status: 'rejected', storeStatus: 'rejected', reason: `storage rejected message: ${err.message}`.slice(0, 300) };
    }
    throw err;
  }
}
