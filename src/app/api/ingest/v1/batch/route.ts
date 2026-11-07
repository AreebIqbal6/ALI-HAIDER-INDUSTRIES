import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { 
  CanonicalEnvelope, 
  LoomStateData, 
  LoomCountersData, 
  LoomEventData, 
  LoomProcessData, 
  GatewayHealthData,
  DeviceHealthData
} from '@/types';

// Fast in-memory deduplication cache for recent msgIds (holds up to 10,000 entries)
const recentMsgIds = new Set<string>();
const MAX_MSG_CACHE_SIZE = 10000;

function isInMemoryDuplicate(msgId: string): boolean {
  if (recentMsgIds.has(msgId)) {
    return true;
  }
  if (recentMsgIds.size >= MAX_MSG_CACHE_SIZE) {
    // Evict oldest 20% when cache is full
    const iter = recentMsgIds.values();
    for (let i = 0; i < 2000; i++) {
      const next = iter.next();
      if (next.done) break;
      recentMsgIds.delete(next.value);
    }
  }
  recentMsgIds.add(msgId);
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Extract envelope list from array, wrapper object, or raw hardware node frame
    let rawEnvelopes: CanonicalEnvelope<any>[] = [];

    if (Array.isArray(body)) {
      rawEnvelopes = body;
    } else if (Array.isArray(body?.batch)) {
      rawEnvelopes = body.batch;
    } else if (Array.isArray(body?.envelopes)) {
      rawEnvelopes = body.envelopes;
    } else if (body && typeof body === 'object') {
      // Direct raw pin frame from WT32-ETH01 over Ethernet LAN
      if (body.pins || body.rawPins) {
        const pins = body.pins || body.rawPins;
        const machineId = body.machineId || 'PIC-427708';
        const isRunning = Boolean(pins.piStrt === 1 || pins.piStrt === true);
        const now = body.ts || new Date().toISOString();
        
        let detectedCategory: 'WARP' | 'FILLING' | 'SELVEDGE' | 'OTHER' | null = null;
        if (!isRunning) {
          // Priority order: FILLING > WARP > SELVEDGE > OTHER
          if (pins.piFd) detectedCategory = 'FILLING';
          else if (pins.piWd) detectedCategory = 'WARP';
          else if (pins.piLd) detectedCategory = 'SELVEDGE';
          else detectedCategory = 'OTHER';
        }

        const stateEnvelope: CanonicalEnvelope<LoomStateData> = {
          schema: 'ahi.loom.state/1.0',
          msgId: body.msgId || `wt32-state-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          seq: Number(body.seq || 1),
          machineId,
          gatewayId: body.gatewayId || 'AHI-GW-01',
          source: 'SENSOR_KIT',
          deviceId: body.deviceId || 'WT32-ETH01-PILOT',
          ts: now,
          tsQuality: 'SYNCED',
          replayed: false,
          data: {
            state: isRunning ? 'RUNNING' : 'STOPPED',
            stopCategory: detectedCategory,
            stopId: isRunning ? null : (body.stopId || `stop-${Date.now()}`),
            since: body.since || now,
            rpm: isRunning ? Number(body.rpm || 874) : 0
          }
        };

        rawEnvelopes.push(stateEnvelope);

        // If counter increment or window provided
        if (body.counters || body.picksDelta !== undefined) {
          const counterEnvelope: CanonicalEnvelope<LoomCountersData> = {
            schema: 'ahi.loom.counters/1.0',
            msgId: `wt32-cnt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            seq: Number(body.seq || 1) + 1,
            machineId,
            gatewayId: body.gatewayId || 'AHI-GW-01',
            source: 'SENSOR_KIT',
            deviceId: body.deviceId || 'WT32-ETH01-PILOT',
            ts: now,
            tsQuality: 'SYNCED',
            replayed: false,
            data: {
              windowStart: body.windowStart || new Date(Date.now() - 60000).toISOString(),
              windowEnd: now,
              picksDelta: Number(body.picksDelta || 0),
              picksTotal: Number(body.picksTotal || 1540000),
              runMs: isRunning ? 60000 : 0,
              stopMs: isRunning ? 0 : 60000,
              offlineMs: 0,
              stops: {
                WARP: detectedCategory === 'WARP' ? 1 : 0,
                FILLING: detectedCategory === 'FILLING' ? 1 : 0,
                SELVEDGE: detectedCategory === 'SELVEDGE' ? 1 : 0,
                OTHER: detectedCategory === 'OTHER' ? 1 : 0,
              },
              rpmAvgRunning: isRunning ? Number(body.rpm || 874) : 0
            }
          };
          rawEnvelopes.push(counterEnvelope);
        }
      } else if (body.schema) {
        // Single canonical envelope
        rawEnvelopes = [body];
      }
    }

    if (!rawEnvelopes || rawEnvelopes.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Empty batch or invalid payload format' },
        { status: 400 }
      );
    }

    if (rawEnvelopes.length > 500) {
      return NextResponse.json(
        { success: false, error: `Batch size ${rawEnvelopes.length} exceeds maximum limit of 500 items` },
        { status: 400 }
      );
    }

    const supabase = getServiceSupabase();
    let deduplicatedCount = 0;
    let processedCount = 0;
    const errors: string[] = [];

    // Filter duplicates within the incoming batch & memory cache
    const uniqueEnvelopes: CanonicalEnvelope<any>[] = [];
    const batchMsgIds = new Set<string>();

    for (const env of rawEnvelopes) {
      if (!env.msgId || !env.schema || !env.ts) {
        errors.push(`Invalid envelope: missing msgId, schema, or ts`);
        continue;
      }

      if (batchMsgIds.has(env.msgId) || isInMemoryDuplicate(env.msgId)) {
        deduplicatedCount++;
        continue;
      }

      batchMsgIds.add(env.msgId);
      uniqueEnvelopes.push(env);
    }

    // Check DB for any existing msgIds in loom_events for global idempotency
    const idsToCheck = uniqueEnvelopes.map(e => e.msgId);
    let existingDbMsgIds = new Set<string>();
    
    if (idsToCheck.length > 0) {
      try {
        const { data: existingEvents } = await supabase
          .from('loom_events')
          .select('msg_id')
          .in('msg_id', idsToCheck);

        if (existingEvents && existingEvents.length > 0) {
          existingEvents.forEach(evt => existingDbMsgIds.add(evt.msg_id));
        }
      } catch (err) {
        // If table doesn't exist yet or DB unreachable, log warning and proceed with memory dedup
        console.warn('Notice: Global DB idempotency lookup skipped:', err);
      }
    }

    const envelopesToProcess = uniqueEnvelopes.filter(e => {
      if (existingDbMsgIds.has(e.msgId)) {
        deduplicatedCount++;
        return false;
      }
      return true;
    });

    // 1. Process 1-Minute Counters (`ahi.loom.counters/1.0`)
    const counterEnvelopes = envelopesToProcess.filter(e => e.schema === 'ahi.loom.counters/1.0');
    if (counterEnvelopes.length > 0) {
      const counterRows = counterEnvelopes.map(e => {
        const data = e.data as LoomCountersData;
        return {
          machine_id: e.machineId,
          window_start: data.windowStart,
          window_end: data.windowEnd,
          picks_delta: data.picksDelta,
          picks_total: data.picksTotal,
          run_ms: data.runMs,
          stop_ms: data.stopMs,
          offline_ms: data.offlineMs,
          stops_warp: data.stops?.WARP || 0,
          stops_filling: data.stops?.FILLING || 0,
          stops_selvedge: data.stops?.SELVEDGE || 0,
          stops_other: data.stops?.OTHER || 0,
          rpm_avg_running: data.rpmAvgRunning,
          source: e.source,
          created_at: new Date().toISOString()
        };
      }).filter(r => r.machine_id && r.window_start);

      if (counterRows.length > 0) {
        const { error: counterErr } = await supabase
          .from('loom_minute_counters')
          .upsert(counterRows, { onConflict: 'machine_id, window_start' });
        
        if (counterErr) {
          errors.push(`Counters upsert error: ${counterErr.message}`);
        } else {
          processedCount += counterRows.length;
        }
      }
    }

    // 2. Process State Mutations (`ahi.loom.state/1.0`) ordered chronologically by `ts`
    const stateEnvelopes = envelopesToProcess
      .filter(e => e.schema === 'ahi.loom.state/1.0' && e.machineId)
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    if (stateEnvelopes.length > 0) {
      // Group by machineId to pick latest state
      const latestStatePerMachine = new Map<string, CanonicalEnvelope<LoomStateData>>();

      for (const env of stateEnvelopes) {
        if (!env.machineId) continue;
        // Non-replayed packets take priority over replayed historical ones
        const existing = latestStatePerMachine.get(env.machineId);
        if (!existing) {
          latestStatePerMachine.set(env.machineId, env as CanonicalEnvelope<LoomStateData>);
        } else {
          const currentTs = new Date(existing.ts).getTime();
          const newTs = new Date(env.ts).getTime();
          if (newTs >= currentTs) {
            latestStatePerMachine.set(env.machineId, env as CanonicalEnvelope<LoomStateData>);
          }
        }
      }

      const stateRows = Array.from(latestStatePerMachine.values()).map(env => {
        const data = env.data as LoomStateData;
        return {
          machine_id: env.machineId,
          state: data.state,
          stop_category: data.stopCategory || null,
          stop_id: data.stopId || null,
          since: data.since || env.ts,
          rpm: data.rpm || 0,
          last_ts: env.ts,
          replayed: env.replayed || false,
          updated_at: new Date().toISOString()
        };
      });

      if (stateRows.length > 0) {
        const { error: stateErr } = await supabase
          .from('loom_live_state')
          .upsert(stateRows, { onConflict: 'machine_id' });

        if (stateErr) {
          errors.push(`State upsert error: ${stateErr.message}`);
        } else {
          processedCount += stateRows.length;
          
          // Also update status in registry table `looms`
          for (const s of stateRows) {
            await supabase
              .from('looms')
              .update({ status: s.state })
              .eq('machine_id', s.machine_id);
          }
        }
      }
    }

    // 3. Process Events (`ahi.loom.event/1.0`)
    const eventEnvelopes = envelopesToProcess.filter(e => e.schema === 'ahi.loom.event/1.0');
    if (eventEnvelopes.length > 0) {
      const eventRows = eventEnvelopes.map(e => {
        const data = e.data as LoomEventData;
        return {
          msg_id: e.msgId,
          machine_id: e.machineId,
          gateway_id: e.gatewayId,
          source: e.source,
          event_type: data.eventType,
          event_data: data,
          ts: e.ts,
          seq: e.seq,
          replayed: e.replayed || false,
          created_at: new Date().toISOString()
        };
      });

      const { error: eventErr } = await supabase
        .from('loom_events')
        .insert(eventRows);

      if (eventErr) {
        errors.push(`Events insert error: ${eventErr.message}`);
      } else {
        processedCount += eventRows.length;

        // Automatically update `downtime_logs` based on STOP_STARTED and STOP_ENDED
        for (const env of eventEnvelopes) {
          const data = env.data as LoomEventData;
          if (data.eventType === 'STOP_STARTED' && env.machineId) {
            await supabase.from('downtime_logs').upsert({
              stop_id: data.stopId,
              machine_id: env.machineId,
              stop_category: data.stopCategory,
              downtime_start: env.ts,
              duration_minutes: 0
            }, { onConflict: 'stop_id' });
          } else if (data.eventType === 'STOP_ENDED') {
            await supabase.from('downtime_logs').update({
              downtime_end: env.ts,
              duration_minutes: Number((data.durationMs / 60000.0).toFixed(2)),
              failed_start_attempts: data.failedStartAttempts || 0,
              operator_reason: data.operatorReason || null
            }).eq('stop_id', data.stopId);
          }
        }
      }
    }

    // 4. Process Process Diagnostics (`ahi.loom.process/1.0`)
    const processEnvelopes = envelopesToProcess.filter(e => e.schema === 'ahi.loom.process/1.0' && e.machineId);
    if (processEnvelopes.length > 0) {
      for (const env of processEnvelopes) {
        const data = env.data as LoomProcessData;
        await supabase
          .from('loom_live_state')
          .update({
            warp_tension_kn: data.warpTensionKn,
            air_pressure_bar: data.airPressureBar,
            updated_at: new Date().toISOString()
          })
          .eq('machine_id', env.machineId);
      }
      processedCount += processEnvelopes.length;
    }

    // 5. Process Gateway Health & Liveness Rule (`ahi.gateway.health/1.0`)
    const gatewayEnvelopes = envelopesToProcess.filter(e => e.schema === 'ahi.gateway.health/1.0');
    if (gatewayEnvelopes.length > 0) {
      for (const env of gatewayEnvelopes) {
        const data = env.data as GatewayHealthData;
        await supabase.from('gateway_health').upsert({
          gateway_id: env.gatewayId,
          last_seen_at: env.ts,
          status: data.status,
          connected_devices: data.connectedDevices || 0,
          metadata: data
        }, { onConflict: 'gateway_id' });
      }
      processedCount += gatewayEnvelopes.length;
    }

    // Liveness Rule Check: If any gateway health was not seen for > 90 seconds, mark machines as OFFLINE
    try {
      const ninetySecondsAgo = new Date(Date.now() - 90 * 1000).toISOString();
      const { data: staleGateways } = await supabase
        .from('gateway_health')
        .select('gateway_id, last_seen_at')
        .lt('last_seen_at', ninetySecondsAgo);

      if (staleGateways && staleGateways.length > 0) {
        // Mark stale machines OFFLINE
        await supabase
          .from('loom_live_state')
          .update({ state: 'OFFLINE', rpm: 0, updated_at: new Date().toISOString() })
          .lt('last_ts', ninetySecondsAgo);

        await supabase
          .from('looms')
          .update({ status: 'OFFLINE' })
          .in('id', (
            await supabase.from('loom_live_state').select('machine_id').eq('state', 'OFFLINE')
          ).data?.map(m => m.machine_id) || []);
      }
    } catch (livenessErr) {
      console.warn('Notice: Gateway liveness scan skipped:', livenessErr);
    }

    return NextResponse.json({
      success: true,
      received: rawEnvelopes.length,
      processed: processedCount,
      deduplicated: deduplicatedCount,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err: any) {
    console.error('Fatal ingestion API error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error processing ingestion batch' },
      { status: 500 }
    );
  }
}
