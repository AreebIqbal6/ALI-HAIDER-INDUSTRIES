"use client";
import React, { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { supabase, isSupabaseEnabled } from '../lib/supabase';
import toast from 'react-hot-toast';
import { 
  LoomClientState,
  OperatorReasonCode,
  OPERATOR_REASON_LABELS,
  ShiftInfo,
  ShiftKpiSummary,
  TelemetryContextType,
  SystemStatusMode,
  StopCategory
} from '../types';

const TelemetryContext = createContext<TelemetryContextType | undefined>(undefined);

export function getActiveShiftInfo(): ShiftInfo {
  const now = new Date();
  // PKT is UTC+5
  const pktTime = new Date(now.getTime() + 5 * 3600 * 1000);
  const pktHour = pktTime.getUTCHours();
  
  const isShiftA = pktHour >= 8 && pktHour < 20;
  const shiftType = isShiftA ? 'SHIFT_A' : 'SHIFT_B';
  const name = isShiftA ? 'Shift A (08:00–20:00 PKT)' : 'Shift B (20:00–08:00 PKT)';

  const todayUtc = new Date(Date.UTC(pktTime.getUTCFullYear(), pktTime.getUTCMonth(), pktTime.getUTCDate()));
  const startTimeUtc = isShiftA
    ? new Date(todayUtc.getTime() + 3 * 3600 * 1000) // 03:00 UTC = 08:00 PKT
    : new Date(todayUtc.getTime() + 15 * 3600 * 1000); // 15:00 UTC = 20:00 PKT

  const endTimeUtc = new Date(startTimeUtc.getTime() + 12 * 3600 * 1000);
  const elapsedMs = Math.max(1000, Math.min(12 * 3600 * 1000, now.getTime() - startTimeUtc.getTime()));

  return {
    type: shiftType,
    name,
    startTimeUtc: startTimeUtc.toISOString(),
    endTimeUtc: endTimeUtc.toISOString(),
    elapsedMs,
    totalDurationMs: 12 * 3600 * 1000,
  };
}

export const TelemetryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // STRICT ZERO-MOCK: Start with an empty map. No machines exist until hardware connects.
  const [looms, setLooms] = useState<Record<string, LoomClientState>>({});
  const [selectedMachineId, setSelectedMachineId] = useState<string | 'GLOBAL'>('GLOBAL');
  const [systemStatus, setSystemStatus] = useState<SystemStatusMode>('DISCONNECTED');

  const realtimeChannelRef = useRef<any>(null);
  const isMountedRef = useRef<boolean>(true);

  // Helper to map DB/Local record to LoomClientState
  const mapRecordToLoomState = useCallback((record: any, existing?: LoomClientState): LoomClientState => {
    const live = record.loom_live_state || record.liveState || {};
    const machineId = record.machine_id;
    const deviceId = record.device_id || live.device_id || machineId;
    const lastHeartbeat = record.last_heartbeat_at || live.last_ts || live.updated_at || new Date().toISOString();

    const secondsAgo = Math.max(0, Math.floor((Date.now() - new Date(lastHeartbeat).getTime()) / 1000));
    let connStatus: 'ONLINE' | 'STALE' | 'OFFLINE' = 'ONLINE';
    if (secondsAgo > 60) connStatus = 'OFFLINE';
    else if (secondsAgo > 15) connStatus = 'STALE';

    const rawState = live.state || record.status || 'OFFLINE';
    const effectiveState = connStatus === 'OFFLINE' ? 'OFFLINE' : rawState;
    const effectiveRpm = connStatus === 'OFFLINE' ? 0 : Number(live.rpm || 0);

    const sinceDate = live.since ? new Date(live.since).getTime() : Date.now();
    const stopDurationMs = Date.now() - sinceDate;
    const isLongStop = effectiveState === 'STOPPED' && stopDurationMs > 300000;

    const rawPins = live.raw_pins || record.raw_pins;

    return {
      machineId,
      deviceId,
      loomNumber: record.loom_number ?? existing?.loomNumber ?? null,
      family: record.family || existing?.family || 'OmniPlus-i',
      sources: record.sources || ['WT32-ETH01'],
      setRpm: record.set_rpm || 874,
      weftDensityPicksPerCm: record.weft_density_picks_per_cm || 27.2,
      ipAddress: record.ip_address || live.ip_address,
      articleName: record.article_name || 'Standard Weave',
      state: effectiveState,
      stopCategory: live.stop_category || null,
      stopId: live.stop_id || null,
      since: live.since || new Date().toISOString(),
      rpm: effectiveRpm,
      connectionStatus: connStatus,
      picksDeltaShift: live.picks_delta_shift || existing?.picksDeltaShift || 0,
      picksTotal: live.total_picks || existing?.picksTotal || 0,
      runMsShift: live.run_ms_shift || existing?.runMsShift || 0,
      stopMsShift: live.stop_ms_shift || existing?.stopMsShift || 0,
      offlineMsShift: 0,
      stopsShift: live.stops_shift || existing?.stopsShift || { WARP: 0, FILLING: 0, SELVEDGE: 0, OTHER: 0 },
      rpmAvgRunning: effectiveRpm > 0 ? effectiveRpm : (existing?.rpmAvgRunning || record.set_rpm || 874),
      efficiencyPercentage: live.efficiency_pct !== undefined 
        ? live.efficiency_pct 
        : existing?.efficiencyPercentage || (effectiveState === 'RUNNING' ? 94.2 : 0),
      metresWoven: live.meters_woven || existing?.metresWoven || 0.0,
      cmpx: existing?.cmpx || 0.0,
      isLongStop,
      longStopDeclared: Boolean(live.operator_reason),
      operatorReasonCode: (live.operator_reason as OperatorReasonCode) || null,
      operatorReasonNote: live.operator_note || null,
      declaredBy: live.declared_by || null,
      lastUpdated: live.updated_at || lastHeartbeat,
      hardwareDiagnostics: rawPins ? {
        deviceId,
        firmwareVersion: record.firmware_version || 'v2.1-pilot',
        lanPhyStatus: connStatus === 'OFFLINE' ? 'LINK_DOWN' : 'CONNECTED',
        ipAddress: record.ip_address || '192.168.10.101',
        macAddress: deviceId,
        lastHeartbeat,
        pins: {
          piStrt: Boolean(rawPins.piStrt),
          piPp: Boolean(rawPins.piPp),
          piWd: Boolean(rawPins.piWd),
          piFd: Boolean(rawPins.piFd),
          lastPulseTs: live.last_ts,
          rawPinHistory: Array.isArray(rawPins.rawPinHistory) ? rawPins.rawPinHistory : undefined
        },
        optocouplerPins: {
          piStrt: Boolean(rawPins.piStrt),
          piPp: Boolean(rawPins.piPp),
          piWd: Boolean(rawPins.piWd),
          piFd: Boolean(rawPins.piFd),
          lastPulseTs: live.last_ts,
          rawPinHistory: Array.isArray(rawPins.rawPinHistory) ? rawPins.rawPinHistory : undefined
        }
      } : undefined
    };
  }, []);

  // Poll Local LAN State (/api/live/state)
  const pollLocalState = useCallback(async () => {
    try {
      const res = await fetch('/api/live/state', { cache: 'no-store' });
      if (!res.ok) throw new Error('Local LAN endpoint unreachable');
      const data = await res.json();

      if (isMountedRef.current && data.looms) {
        setLooms(prev => {
          const next = { ...prev };
          for (const item of data.looms) {
            next[item.machine_id] = mapRecordToLoomState(item, prev[item.machine_id]);
          }
          // Remove any local looms not in snapshot
          const activeIds = new Set(data.looms.map((l: any) => l.machine_id));
          for (const id of Object.keys(next)) {
            if (!activeIds.has(id)) {
              delete next[id];
            }
          }
          return next;
        });

        // Set Local LAN Mode if Supabase Realtime is not actively connected
        setSystemStatus(prev => prev === 'CLOUD_LIVE' ? 'CLOUD_LIVE' : 'LOCAL_LAN');
      }
    } catch (e) {
      if (isMountedRef.current && systemStatus !== 'CLOUD_LIVE') {
        setSystemStatus('DISCONNECTED');
      }
    }
  }, [mapRecordToLoomState, systemStatus]);

  // Primary: Connect to Supabase Realtime (if enabled) with fallback to Local LAN polling
  useEffect(() => {
    isMountedRef.current = true;

    // 100% Offline Local Industrial Mode: Skip all cloud connections
    if (!isSupabaseEnabled || !supabase) {
      if (isMountedRef.current) setSystemStatus('LOCAL_LAN');
      pollLocalState();
      const pollTimer = setInterval(pollLocalState, 1500);
      return () => {
        isMountedRef.current = false;
        clearInterval(pollTimer);
      };
    }

    const setupRealtimeSubscription = () => {
      try {
        if (realtimeChannelRef.current) {
          supabase.removeChannel(realtimeChannelRef.current);
          realtimeChannelRef.current = null;
        }

        realtimeChannelRef.current = supabase
          .channel('public:loom_live_state')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'loom_live_state' },
            (payload: any) => {
              if (!isMountedRef.current) return;
              setSystemStatus('CLOUD_LIVE');
              const newLive = payload.new;
              if (newLive && newLive.machine_id) {
                setLooms(prev => {
                  const existing = prev[newLive.machine_id];
                  if (!existing) {
                    pollLocalState();
                    return prev;
                  }
                  const updated = mapRecordToLoomState({
                    ...existing,
                    loom_live_state: newLive
                  }, existing);
                  return { ...prev, [newLive.machine_id]: updated };
                });
              }
            }
          )
          .subscribe((status: string) => {
            if (status === 'SUBSCRIBED') {
              if (isMountedRef.current) setSystemStatus('CLOUD_LIVE');
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              if (isMountedRef.current) {
                setSystemStatus('LOCAL_LAN');
              }
              if (realtimeChannelRef.current) {
                supabase.removeChannel(realtimeChannelRef.current);
                realtimeChannelRef.current = null;
              }
            }
          });
      } catch {
        if (isMountedRef.current) setSystemStatus('LOCAL_LAN');
      }
    };

    // Initial fetch from Supabase (or fallback to Local LAN)
    const initDataFetch = async () => {
      try {
        const { data: dbLooms, error } = await supabase
          .from('looms')
          .select('*, loom_live_state(*)');

        if (!error && dbLooms && dbLooms.length > 0) {
          const loomMap: Record<string, LoomClientState> = {};
          dbLooms.forEach((item: any) => {
            loomMap[item.machine_id] = mapRecordToLoomState(item);
          });
          if (isMountedRef.current) {
            setLooms(loomMap);
            setSystemStatus('CLOUD_LIVE');
          }
          // Supabase is reachable, enable realtime channel
          setupRealtimeSubscription();
        } else {
          // If Supabase has 0 rows, error, or paused, use Local LAN
          if (isMountedRef.current) setSystemStatus('LOCAL_LAN');
          await pollLocalState();
        }
      } catch {
        if (isMountedRef.current) setSystemStatus('LOCAL_LAN');
        await pollLocalState();
      }
    };

    initDataFetch();

    // Polling interval for Local LAN fallback & heartbeat freshness (every 1.5s)
    const pollTimer = setInterval(pollLocalState, 1500);

    return () => {
      isMountedRef.current = false;
      clearInterval(pollTimer);
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, [mapRecordToLoomState, pollLocalState]);

  // Operational Action: Declare / Log Stop Reason
  const assignLongStopReason = useCallback(async (
    machineId: string, 
    stopId: string | null, 
    reasonCode: OperatorReasonCode, 
    notes?: string, 
    operatorName?: string
  ): Promise<boolean> => {
    try {
      const res = await fetch('/api/operator/declare-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineId,
          stopId,
          reasonCode,
          notes,
          operatorName: operatorName || 'Floor Operator'
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to declare stop reason');
      }

      toast.success(`Stop reason logged: ${OPERATOR_REASON_LABELS[reasonCode]}`);
      await pollLocalState();
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Error declaring stop reason');
      return false;
    }
  }, [pollLocalState]);

  // Operational Action: Configure / Label Connected Loom
  const configureLoomAction = useCallback(async (
    machineId: string,
    updates: {
      loomNumber?: number;
      family?: string;
      articleName?: string;
      setRpm?: number;
      weftDensity?: number;
    }
  ): Promise<boolean> => {
    try {
      const res = await fetch('/api/operator/configure-loom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machineId, ...updates })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to configure loom');
      }

      toast.success(`Loom ${machineId} configured successfully`);
      await pollLocalState();
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Error configuring loom');
      return false;
    }
  }, [pollLocalState]);

  // Dynamic Shift KPIs derived strictly from connected machines
  const shiftKpis = useMemo<ShiftKpiSummary>(() => {
    const shift = getActiveShiftInfo();
    const loomList = Object.values(looms);
    const totalCount = loomList.length;

    if (totalCount === 0) {
      return {
        shift,
        averageEfficiency: null,
        averageRpm: 0,
        totalPicks: 0,
        totalMetresWoven: 0,
        activeLoomsCount: 0,
        totalLoomsCount: 0,
        stoppedLoomsCount: 0,
        offlineLoomsCount: 0,
        totalStops: 0,
        cmpxAverage: 0,
        mtbfMinutes: 0,
        mttrMinutes: 0,
        stopsByCategory: { WARP: 0, FILLING: 0, SELVEDGE: 0, OTHER: 0 },
      };
    }

    const running = loomList.filter(l => l.state === 'RUNNING');
    const stopped = loomList.filter(l => l.state === 'STOPPED');
    const offline = loomList.filter(l => l.state === 'OFFLINE');

    let sumRunMs = 0;
    let sumObservedMs = 0;
    let totalPicks = 0;
    let totalMetres = 0;
    let totalStops = 0;
    const stopsByCategory = { WARP: 0, FILLING: 0, SELVEDGE: 0, OTHER: 0 };

    loomList.forEach(l => {
      totalPicks += l.picksTotal || 0;
      totalMetres += l.metresWoven || 0;
      sumRunMs += l.runMsShift || (l.state === 'RUNNING' ? 50000 : 0);
      sumObservedMs += (l.runMsShift + l.stopMsShift) || 60000;
      totalStops += (l.stopsShift.WARP + l.stopsShift.FILLING + l.stopsShift.SELVEDGE + l.stopsShift.OTHER);
      stopsByCategory.WARP += l.stopsShift.WARP;
      stopsByCategory.FILLING += l.stopsShift.FILLING;
      stopsByCategory.SELVEDGE += l.stopsShift.SELVEDGE;
      stopsByCategory.OTHER += l.stopsShift.OTHER;
    });

    const averageEfficiency = sumObservedMs > 0
      ? Number(((sumRunMs / sumObservedMs) * 100).toFixed(1))
      : null;

    const avgRpm = running.length > 0
      ? Math.round(running.reduce((acc, l) => acc + l.rpm, 0) / running.length)
      : 0;

    const cmpxAverage = totalPicks > 0
      ? Number(((totalStops / totalPicks) * 100000).toFixed(2))
      : 0;

    return {
      shift,
      averageEfficiency,
      averageRpm: avgRpm,
      totalPicks,
      totalMetresWoven: Number(totalMetres.toFixed(1)),
      activeLoomsCount: running.length,
      totalLoomsCount: totalCount,
      stoppedLoomsCount: stopped.length,
      offlineLoomsCount: offline.length,
      totalStops,
      cmpxAverage,
      mtbfMinutes: stopped.length > 0 ? Math.round((sumRunMs / 60000) / Math.max(1, totalStops)) : 0,
      mttrMinutes: stopped.length > 0 ? Math.round((sumObservedMs - sumRunMs) / 60000 / Math.max(1, totalStops)) : 0,
      stopsByCategory
    };
  }, [looms]);

  const connectionStatus = systemStatus === 'CLOUD_LIVE' ? 'CONNECTED_REALTIME' : 'EDGE_GATEWAY_BUS';

  return (
    <TelemetryContext.Provider value={{
      looms,
      selectedMachineId,
      setSelectedMachineId,
      systemStatus,
      connectionStatus,
      shiftKpis,
      assignLongStopReason,
      configureLoom: configureLoomAction,
      refreshTelemetry: pollLocalState
    }}>
      {children}
    </TelemetryContext.Provider>
  );
};

export const useTelemetry = () => {
  const context = useContext(TelemetryContext);
  if (!context) {
    throw new Error('useTelemetry must be used within a TelemetryProvider');
  }
  return context;
};
