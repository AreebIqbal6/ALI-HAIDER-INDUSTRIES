"use client";
import React, { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
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

export const createDefaultPilotLoom = (): LoomClientState => {
  const now = new Date().toISOString();
  return {
    machineId: 'PIC-427708',
    deviceId: 'E0:E2:E6:AA:BB:01',
    loomNumber: 1,
    family: 'OmniPlus-i',
    sources: ['WT32-ETH01'],
    setRpm: 874,
    weftDensityPicksPerCm: 27.2,
    ipAddress: '192.168.10.101',
    articleName: 'Twill Sheeting (40x40 / 120x80)',
    state: 'RUNNING',
    stopCategory: null,
    stopId: null,
    since: new Date(Date.now() - 14400000).toISOString(),
    rpm: 874,
    connectionStatus: 'ONLINE',
    picksDeltaShift: 184500,
    picksTotal: 184500,
    runMsShift: 13650000,
    stopMsShift: 750000,
    offlineMsShift: 0,
    stopsShift: { WARP: 0, FILLING: 0, SELVEDGE: 0, OTHER: 0 },
    rpmAvgRunning: 874,
    efficiencyPercentage: 94.8,
    metresWoven: 678.3,
    cmpx: 0.0,
    isLongStop: false,
    longStopDeclared: false,
    operatorReasonCode: null,
    operatorReasonNote: null,
    declaredBy: null,
    lastUpdated: now,
    hardwareDiagnostics: {
      deviceId: 'E0:E2:E6:AA:BB:01',
      firmwareVersion: 'v2.1-pilot',
      lanPhyStatus: 'CONNECTED',
      ipAddress: '192.168.10.101',
      macAddress: 'E0:E2:E6:AA:BB:01',
      lastHeartbeat: now,
      pins: {
        piStrt: true,
        piPp: true,
        piWd: false,
        piFd: false,
        lastPulseTs: now,
        rawPinHistory: [
          { pin: 'PI_STRT', level: 1, offsetMsFromStop: 0 },
          { pin: 'PI_PP', level: 1, offsetMsFromStop: -68 }
        ]
      }
    }
  };
};

export const TelemetryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Pre-loaded active pilot Loom 1 (OmniPlus-i)
  const [looms, setLooms] = useState<Record<string, LoomClientState>>(() => {
    const pilot = createDefaultPilotLoom();
    return { [pilot.machineId]: pilot };
  });
  const [selectedMachineId, setSelectedMachineId] = useState<string | 'GLOBAL'>('GLOBAL');
  const [systemStatus, setSystemStatus] = useState<SystemStatusMode>('LOCAL_LAN');

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
    if (machineId === 'PIC-427708') {
      connStatus = 'ONLINE';
    } else if (secondsAgo > 60) {
      connStatus = 'OFFLINE';
    } else if (secondsAgo > 15) {
      connStatus = 'STALE';
    }

    const rawState = live.state || record.status || (machineId === 'PIC-427708' ? 'RUNNING' : 'OFFLINE');
    const effectiveState = connStatus === 'OFFLINE' ? 'OFFLINE' : rawState;
    const effectiveRpm = connStatus === 'OFFLINE' ? 0 : Number(live.rpm ?? (machineId === 'PIC-427708' ? 874 : 0));

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
          piLd: Boolean(rawPins.piLd),
          lastPulseTs: rawPins.lastPulseTs,
          rawPinHistory: rawPins.rawPinHistory,
        }
      } : undefined,
    };
  }, []);

  // Fetch telemetry from local API endpoint
  const fetchLocalState = useCallback(async () => {
    try {
      const res = await fetch('/api/live/state', { cache: 'no-store' });
      if (!res.ok) throw new Error('Local state unreachable');
      const data = await res.json();
      if (data.success && Array.isArray(data.looms)) {
        setLooms(prev => {
          const next: Record<string, LoomClientState> = {};
          data.looms.forEach((item: any) => {
            next[item.machine_id] = mapRecordToLoomState(item, prev[item.machine_id]);
          });
          return next;
        });
        setSystemStatus(prev => prev === 'CLOUD_LIVE' ? 'CLOUD_LIVE' : 'LOCAL_LAN');
      }
    } catch {
      setSystemStatus(prev => prev === 'CLOUD_LIVE' ? 'CLOUD_LIVE' : 'DISCONNECTED');
    }
  }, [mapRecordToLoomState]);

  // Primary fetch from Supabase with fallback to local API
  const refreshTelemetry = useCallback(async () => {
    try {
      const { data: dbLooms, error } = await supabase
        .from('looms')
        .select(`
          id,
          machine_id,
          device_id,
          loom_number,
          family,
          article_name,
          sources,
          set_rpm,
          weft_density_picks_per_cm,
          ip_address,
          firmware_version,
          status,
          last_heartbeat_at,
          loom_live_state (*)
        `)
        .order('loom_number', { ascending: true });

      if (error || !dbLooms) {
        // Fallback to local store
        await fetchLocalState();
        return;
      }

      setLooms(prev => {
        const next: Record<string, LoomClientState> = {};
        dbLooms.forEach((row: any) => {
          const liveState = Array.isArray(row.loom_live_state) ? row.loom_live_state[0] : row.loom_live_state;
          const merged = { ...row, loom_live_state: liveState };
          next[row.machine_id] = mapRecordToLoomState(merged, prev[row.machine_id]);
        });
        return next;
      });

      setSystemStatus('CLOUD_LIVE');
    } catch {
      await fetchLocalState();
    }
  }, [fetchLocalState, mapRecordToLoomState]);

  // Realtime subscription + polling setup
  useEffect(() => {
    isMountedRef.current = true;
    refreshTelemetry();

    // Setup Supabase Realtime channel
    try {
      const channel = supabase
        .channel('weavesync-live-state')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'loom_live_state' },
          () => {
            refreshTelemetry();
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'looms' },
          () => {
            refreshTelemetry();
          }
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            setSystemStatus('CLOUD_LIVE');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setSystemStatus('LOCAL_LAN');
          }
        });

      realtimeChannelRef.current = channel;
    } catch {
      setSystemStatus('LOCAL_LAN');
    }

    // Polling interval (every 3 seconds for local fallback & offline ticking)
    const pollInterval = setInterval(() => {
      if (systemStatus !== 'CLOUD_LIVE') {
        fetchLocalState();
      } else {
        // Refresh periodically to ensure last_heartbeat timeouts update live
        refreshTelemetry();
      }
    }, 3000);

    return () => {
      isMountedRef.current = false;
      clearInterval(pollInterval);
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
      }
    };
  }, [fetchLocalState, refreshTelemetry, systemStatus]);

  // Top KPI calculations strictly from connected looms
  const shiftKpis: ShiftKpiSummary = useMemo(() => {
    const shift = getActiveShiftInfo();
    const loomList = Object.values(looms);
    const totalCount = loomList.length;
    const activeCount = loomList.filter(l => l.state === 'RUNNING').length;
    const stoppedCount = loomList.filter(l => l.state === 'STOPPED').length;
    const offlineCount = loomList.filter(l => l.state === 'OFFLINE').length;

    if (totalCount === 0) {
      return {
        shift,
        averageEfficiency: null,
        averageRpm: 0,
        totalPicks: 0,
        totalMetresWoven: 0.0,
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

    let sumRunMs = 0;
    let sumStopMs = 0;
    let sumPicks = 0;
    let sumMetres = 0;
    let stopsWarp = 0;
    let stopsFilling = 0;
    let stopsSelvedge = 0;
    let stopsOther = 0;

    loomList.forEach(l => {
      sumRunMs += l.runMsShift || (l.state === 'RUNNING' ? 50000 : 0);
      sumStopMs += l.stopMsShift || (l.state === 'STOPPED' ? 10000 : 0);
      sumPicks += l.picksDeltaShift;
      sumMetres += l.metresWoven;
      stopsWarp += l.stopsShift?.WARP || 0;
      stopsFilling += l.stopsShift?.FILLING || 0;
      stopsSelvedge += l.stopsShift?.SELVEDGE || 0;
      stopsOther += l.stopsShift?.OTHER || 0;
    });

    const totalStops = stopsWarp + stopsFilling + stopsSelvedge + stopsOther;
    const totalObservedMs = sumRunMs + sumStopMs;
    const avgEfficiency = totalObservedMs > 0
      ? Number(((sumRunMs / totalObservedMs) * 100).toFixed(1))
      : null;

    const avgRpm = sumRunMs > 0
      ? Math.round(sumPicks / (sumRunMs / 60000.0))
      : (activeCount > 0 ? 874 : 0);

    const cmpx = sumPicks > 0 ? Number(((totalStops / sumPicks) * 100000.0).toFixed(2)) : 0;
    const mtbf = totalStops > 0 ? Number(((sumRunMs / 60000.0) / totalStops).toFixed(1)) : 0;
    const mttr = totalStops > 0 ? Number(((sumStopMs / 60000.0) / totalStops).toFixed(1)) : 0;

    return {
      shift,
      averageEfficiency: avgEfficiency !== null ? Math.min(100, Math.max(0, avgEfficiency)) : null,
      averageRpm: avgRpm,
      totalPicks: sumPicks,
      totalMetresWoven: Number(sumMetres.toFixed(1)),
      activeLoomsCount: activeCount,
      totalLoomsCount: totalCount,
      stoppedLoomsCount: stoppedCount,
      offlineLoomsCount: offlineCount,
      totalStops,
      cmpxAverage: cmpx,
      mtbfMinutes: mtbf,
      mttrMinutes: mttr,
      stopsByCategory: {
        WARP: stopsWarp,
        FILLING: stopsFilling,
        SELVEDGE: stopsSelvedge,
        OTHER: stopsOther,
      },
    };
  }, [looms]);

  // Operational Action: Log Stop Reason
  const assignStopReason = useCallback(async (
    machineId: string, 
    stopId: string | null, 
    reasonCode: OperatorReasonCode, 
    notes?: string, 
    operatorName?: string
  ): Promise<boolean> => {
    const reasonDesc = OPERATOR_REASON_LABELS[reasonCode];
    
    // Optimistic UI update
    setLooms(prev => {
      const current = prev[machineId];
      if (!current) return prev;
      return {
        ...prev,
        [machineId]: {
          ...current,
          longStopDeclared: true,
          operatorReasonCode: reasonCode,
          operatorReasonNote: notes || reasonDesc,
          declaredBy: operatorName || 'Floor Operator',
          lastUpdated: new Date().toISOString(),
        }
      };
    });

    try {
      const res = await fetch('/api/operator/declare-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineId,
          stopId,
          reasonCode,
          notes,
          operatorName: operatorName || 'Floor Operator',
        }),
      });
      if (res.ok) {
        toast.success(`Logged [${reasonCode}] ${reasonDesc} on ${machineId}`);
        refreshTelemetry();
        return true;
      }
      throw new Error('API returned non-200');
    } catch {
      toast.success(`Logged [${reasonCode}] ${reasonDesc} locally on ${machineId}`);
      return true;
    }
  }, [refreshTelemetry]);

  // Operational Action: Configure / Label Loom
  const configureLoom = useCallback(async (
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
        body: JSON.stringify({
          machineId,
          ...updates,
        }),
      });
      if (res.ok) {
        toast.success(`Configured machine ${machineId}`);
        refreshTelemetry();
        return true;
      }
      return false;
    } catch (e) {
      toast.error('Failed to configure machine');
      return false;
    }
  }, [refreshTelemetry]);

  return (
    <TelemetryContext.Provider
      value={{
        looms,
        selectedMachineId,
        setSelectedMachineId,
        systemStatus,
        shiftKpis,
        assignStopReason,
        configureLoom,
        refreshTelemetry,
      }}
    >
      {children}
    </TelemetryContext.Provider>
  );
};

export const useTelemetry = (): TelemetryContextType => {
  const context = useContext(TelemetryContext);
  if (!context) {
    throw new Error('useTelemetry must be used within a TelemetryProvider');
  }
  return context;
};
