// Storage abstraction for contract v1 ingest so the route can be tested without a DB.
import type { Envelope } from '@/lib/contract';

export interface DeviceRecord {
  deviceId: string;
  machineId: string;
  status: string; // 'active' | 'disabled'
}

/** What the database function ingest_message() returns. */
export type StoreStatus = 'stored' | 'duplicate' | 'stale' | 'rejected';

/** Envelope as handed to the store, after server-side normalisation (skew rule). */
export type StoredEnvelope = Envelope & {
  /** set by the server when ts was > 5 min in the future (ts kept, ordering uses received_at) */
  clockSkewed?: boolean;
};

export interface IngestStore {
  findDeviceByTokenHash(tokenHash: string): Promise<DeviceRecord | null>;
  ingestMessage(env: StoredEnvelope, receivedAt: Date): Promise<StoreStatus>;
}

/** Bad data for this one message: report as rejected, keep processing the batch. */
export class PermanentIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentIngestError';
  }
}

/** DB/network unavailable: abort the batch with 503 so the device keeps it buffered. */
export class TransientIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientIngestError';
  }
}
