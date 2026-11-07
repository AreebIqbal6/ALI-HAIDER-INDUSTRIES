import { outbox, OutboxRow } from './outbox';
import { supabase } from './index';

export interface ForwarderMetrics {
  totalForwarded: number;
  totalFailed: number;
  lastBatchTimeMs: number;
  lastSuccessfulForwardTs: string | null;
  isOnline: boolean;
}

export class TelemetryForwarder {
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private metrics: ForwarderMetrics = {
    totalForwarded: 0,
    totalFailed: 0,
    lastBatchTimeMs: 0,
    lastSuccessfulForwardTs: null,
    isOnline: false
  };

  public start(intervalMs = 1000): void {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(`🚀 [FORWARDER] Telemetry forwarder daemon active (Poll Interval: ${intervalMs}ms)`);
    this.timer = setInterval(() => this.flush(), intervalMs);
  }

  public async flush(): Promise<void> {
    const pending = outbox.getPending(50);
    if (pending.length === 0) return;

    const startTime = Date.now();
    const successfulIds: number[] = [];

    // Group envelopes by schema for efficient batch upserting
    const stateEnvelopes: Array<{ id: number; data: any; ts: string; machineId: string }> = [];
    const counterEnvelopes: Array<{ id: number; data: any; ts: string; machineId: string; source: string }> = [];
    const genericEnvelopes: OutboxRow[] = [];

    for (const row of pending) {
      try {
        const parsed = JSON.parse(row.payload);
        if (row.schema === 'ahi.loom.state/1.0') {
          stateEnvelopes.push({
            id: row.id,
            data: parsed.data,
            ts: parsed.ts,
            machineId: parsed.machineId || row.machine_id
          });
        } else if (row.schema === 'ahi.loom.counters/1.0') {
          counterEnvelopes.push({
            id: row.id,
            data: parsed.data,
            ts: parsed.ts,
            machineId: parsed.machineId || row.machine_id,
            source: parsed.source || row.source
          });
        } else {
          genericEnvelopes.push(row);
        }
      } catch (err: any) {
        outbox.markFailed(row.id, `JSON parse error: ${err.message}`);
      }
    }

    if (!supabase) {
      // In dry run or local-only mode without Supabase credentials
      this.metrics.isOnline = false;
      this.metrics.lastBatchTimeMs = Date.now() - startTime;
      outbox.markSent(pending.map(p => p.id));
      this.metrics.totalForwarded += pending.length;
      return;
    }

    try {
      // 1. Batch upsert live state records
      if (stateEnvelopes.length > 0) {
        const rows = stateEnvelopes.map(e => ({
          machine_id: e.machineId,
          state: e.data.state,
          stop_category: e.data.stopCategory,
          stop_id: e.data.stopId,
          since: e.data.since || e.ts,
          rpm: e.data.rpm,
          last_ts: e.ts,
          replayed: false,
          updated_at: new Date().toISOString()
        }));

        const { error } = await supabase.from('loom_live_state').upsert(rows, { onConflict: 'machine_id' });
        if (error) throw error;
        stateEnvelopes.forEach(e => successfulIds.push(e.id));
      }

      // 2. Batch upsert 1-minute counters
      if (counterEnvelopes.length > 0) {
        const rows = counterEnvelopes.map(e => ({
          machine_id: e.machineId,
          window_start: e.data.windowStart,
          window_end: e.data.windowEnd,
          picks_delta: e.data.picksDelta,
          picks_total: e.data.picksTotal,
          run_ms: e.data.runMs,
          stop_ms: e.data.stopMs,
          offline_ms: e.data.offlineMs,
          stops_warp: e.data.stops?.WARP || 0,
          stops_filling: e.data.stops?.FILLING || 0,
          stops_selvedge: e.data.stops?.SELVEDGE || 0,
          stops_other: e.data.stops?.OTHER || 0,
          rpm_avg_running: e.data.rpmAvgRunning || 0,
          source: e.source,
          created_at: new Date().toISOString()
        }));

        const { error } = await supabase.from('loom_minute_counters').upsert(rows, { onConflict: 'machine_id, window_start' });
        if (error) throw error;
        counterEnvelopes.forEach(e => successfulIds.push(e.id));
      }

      // 3. Mark generic envelopes as processed
      genericEnvelopes.forEach(e => successfulIds.push(e.id));

      // Commit successful dispatch in SQLite outbox
      outbox.markSent(successfulIds);

      this.metrics.isOnline = true;
      this.metrics.totalForwarded += successfulIds.length;
      this.metrics.lastSuccessfulForwardTs = new Date().toISOString();
      this.metrics.lastBatchTimeMs = Date.now() - startTime;

    } catch (err: any) {
      this.metrics.isOnline = false;
      this.metrics.totalFailed += pending.length;
      console.warn(`⚠️ [FORWARDER] Cloud dispatch deferred (${err.message}). Safe in SQLite WAL outbox.`);
      pending.forEach(r => outbox.markFailed(r.id, err.message));
    }
  }

  public getMetrics(): ForwarderMetrics {
    return { ...this.metrics };
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }
}

export const forwarder = new TelemetryForwarder();
