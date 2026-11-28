"use client";
import React, { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
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
  LoomStateKind,
  StopCategory,
} from '../types';

const TelemetryContext = createContext<TelemetryContextType | undefined>(undefined);

export function getActiveShiftInfo(now: Date = new Date()): ShiftInfo {
  // PKT is UTC+5
  const pktTime = new Date(now.getTime() + 5 * 3600 * 1000);
  const pktHour = pktTime.getUTCHours();

  const isShiftA = pktHour >= 8 && pktHour < 20;
  const shiftType = isShiftA ? 'SHIFT_A' : 'SHIFT_B';
  const name = isShiftA ? 'Shift A (08:00–20:00 PKT)' : 'Shift B (20:00–08:00 PKT)';

  const todayPktMidnightUtc = Date.UTC(
    pktTime.getUTCFullYear(),
    pktTime.getUTCMonth(),
    pktTime.getUTCDate(),
  );

  let startTimeMs: number;
  if (isShiftA) {
    // 08:00 PKT = 03:00 UTC same PKT calendar date
    startTimeMs = todayPktMidnightUtc + 3 * 3600 * 1000;
  } else if (pktHour >= 20) {
    // 20:00 PKT = 15:00 UTC same PKT calendar date
    startTimeMs = todayPktMidnightUtc + 15 * 3600 * 1000;
  } else {
    // 00:00–07:59 PKT -> Shift B started yesterday at 20:00 PKT (15:00 UTC yesterday)
    startTimeMs = todayPktMidnightUtc - 9 * 3600 * 1000;
  }

  const startTimeUtc = new Date(startTimeMs);
  const endTimeUtc = new Date(startTimeMs + 12 * 3600 * 1000);
  const elapsedMs = Math.max(1000, Math.min(12 * 3600 * 1000, now.getTime() - startTimeMs));

  return {
    type: shiftType,
    name,
    startTimeUtc: startTimeUtc.toISOString(),
    endTimeUtc: endTimeUtc.toISOString(),
    elapsedMs,
    totalDurationMs: 12 * 3600 * 1000,
  };
}

interface RawPinData {
  piStrt?: number | boolean;
  piPp?: number | boolean;
  piWd?: number | boolean;
  piFd?: number | boolean;
  rawPinHistory?: Array<{ pin: string; level?: number; state?: number; offsetMsFromStop?: number; ms?: number }>;
}

interface RawStopsShift {
  WARP: number;
  FILLING: number;
  SELVEDGE: number;
  OTHER: number;
}

interface RawLiveStateRecord {
  machine_id?: string;
  device_id?: string | null;
  state?: LoomStateKind;
  stop_category?: StopCategory | null;
  stop_id?: string | null;
  since?: string;
  rpm?: number;
  total_picks?: number;
  meters_woven?: number;
  raw_pins?: RawPinData | null;
  operator_reason?: string | null;
  operator_note?: string | null;
  declared_by?: string | null;
  run_ms_shift?: number;
  stop_ms_shift?: number;
  picks_delta_shift?: number;
  efficiency_pct?: number;
  stops_shift?: RawStopsShift;
  ip_address?: string;
  last_ts?: string;
  updated_at?: string;
}

interface RawLoomRecord {
  machine_id: string;
  device_id?: string | null;
  loom_number?: number | null;
  family?: string;
  article_name?: string | null;
  sources?: string[];
  set_rpm?: number;
  weft_density_picks_per_cm?: number;
  ip_address?: string | null;
  firmware_version?: string | null;
  status?: LoomStateKind;
  last_heartbeat_at?: string | null;
  loom_live_state?: RawLiveStateRecord | RawLiveStateRecord[] | null;
  liveState?: RawLiveStateRecord | null;
  raw_pins?: RawPinData | null;
}

interface ShiftCounterAggregate {
  runMs: number;
  stopMs: number;
  picksDelta: number;
  stops: RawStopsShift;
}

interface DeviceHealthRow {
  device_id: string;
  machine_id?: string | null;
  ip_address?: string | null;
  firmware_version?: string | null;
}

interface MinuteCounterRow {
  machine_id: string;
  picks_delta: number | null;
  run_ms: number | null;
  stop_ms: number | null;
  stops_warp: number | null;
  stops_filling: number | null;
  stops_selvedge: number | null;
  stops_other: number | null;
}

export const TelemetryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // STRICT ZERO-MOCK: Start with an empty map. No machines exist until hardware connects.
  const [looms, setLooms] = useState<Record<string, LoomClientState>>({});
  const [selectedMachineId, setSelectedMachineId] = useState<string | 'GLOBAL'>('GLOBAL');
  const [systemStatus, setSystemStatus] = useState<SystemStatusMode>(() =>
    !isSupabaseEnabled || !supabase ? 'LOCAL_LAN' : 'CONNECTING',
  );
  const [shiftStartKey, setShiftStartKey] = useState<string>(() => getActiveShiftInfo().startTimeUtc);

  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const lastHeartbeatRef = useRef<Record<string, string | null>>({});
  const shiftCountersRef = useRef<Record<string, ShiftCounterAggregate>>({});
  const deviceHealthRef = useRef<Record<string, DeviceHealthRow>>({});
  const deviceHealthByMachineRef = useRef<Record<string, DeviceHealthRow>>({});

  const detachRealtimeChannel = useCallback(() => {
    const ch = realtimeChannelRef.current;
    if (!ch || !supabase) return;
    realtimeChannelRef.current = null;
    try {
      void supabase.removeChannel(ch);
    } catch {
      // Ignore teardown errors
    }
  }, []);

  // Helper to map DB/Local record to LoomClientState
  const mapRecordToLoomState = useCallback(
    (record: RawLoomRecord, existing?: LoomClientState): LoomClientState => {
      const rawLive = record.loom_live_state;
      const live: RawLiveStateRecord =
        (Array.isArray(rawLive) ? rawLive[0] : rawLive) || record.liveState || {};
      const machineId = record.machine_id;
      const deviceId = record.device_id || live.device_id || machineId;
      const health = deviceHealthRef.current[deviceId] || deviceHealthByMachineRef.current[machineId];

      // Liveness comes ONLY from the server receive time (looms.last_heartbeat_at),
      // never from the device clock and never from "now" — no heartbeat => OFFLINE.
      const lastHeartbeat: string | null = record.last_heartbeat_at || null;
      lastHeartbeatRef.current[machineId] = lastHeartbeat;
      const heartbeatMs = lastHeartbeat ? new Date(lastHeartbeat).getTime() : Number.NaN;
      const secondsAgo = Number.isNaN(heartbeatMs)
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Math.floor((Date.now() - heartbeatMs) / 1000));
      let connStatus: 'ONLINE' | 'STALE' | 'OFFLINE' = 'ONLINE';
      if (secondsAgo > 60) connStatus = 'OFFLINE';
      else if (secondsAgo > 15) connStatus = 'STALE';

      const rawState: LoomStateKind = live.state || record.status || 'OFFLINE';
      const effectiveState: LoomStateKind = connStatus === 'OFFLINE' ? 'OFFLINE' : rawState;
      const effectiveRpm = connStatus === 'OFFLINE' ? 0 : Number(live.rpm || 0);

      const sinceDate = live.since ? new Date(live.since).getTime() : Date.now();
      const stopDurationMs = Date.now() - sinceDate;
      const isLongStop = effectiveState === 'STOPPED' && stopDurationMs > 300000;

      const rawPins = live.raw_pins || record.raw_pins;
      const hasPinValues =
        rawPins &&
        (rawPins.piStrt !== undefined ||
          rawPins.piPp !== undefined ||
          rawPins.piWd !== undefined ||
          rawPins.piFd !== undefined ||
          Array.isArray(rawPins.rawPinHistory));

      const counters = shiftCountersRef.current[machineId];
      const runMsShift = live.run_ms_shift ?? counters?.runMs ?? 0;
      const stopMsShift = live.stop_ms_shift ?? counters?.stopMs ?? 0;
      const picksDeltaShift = live.picks_delta_shift ?? counters?.picksDelta ?? 0;
      const stopsShift: RawStopsShift = live.stops_shift ??
        counters?.stops ?? { WARP: 0, FILLING: 0, SELVEDGE: 0, OTHER: 0 };

      const observedMs = runMsShift + stopMsShift;
      const efficiencyPercentage =
        typeof live.efficiency_pct === 'number'
          ? live.efficiency_pct
          : observedMs > 0
            ? Number(((runMsShift / observedMs) * 100).toFixed(1))
            : null;

      const weftDensity = Number(record.weft_density_picks_per_cm || 27.2);
      const totalPicks = Number(live.total_picks ?? existing?.picksTotal ?? 0);
      const liveMeters = Number(live.meters_woven ?? 0);
      const derivedMeters =
        picksDeltaShift > 0
          ? Number((picksDeltaShift / (weftDensity * 100)).toFixed(1))
          : 0;
      const metresWoven = liveMeters > 0 ? liveMeters : derivedMeters;

      const loomStopsTotal =
        stopsShift.WARP + stopsShift.FILLING + stopsShift.SELVEDGE + stopsShift.OTHER;
      const basePicks = picksDeltaShift || totalPicks;
      const cmpx =
        basePicks > 0 ? Number(((loomStopsTotal / basePicks) * 100000).toFixed(2)) : 0;

      const resolvedIp = record.ip_address || live.ip_address || health?.ip_address || undefined;
      const resolvedFw = record.firmware_version || health?.firmware_version || '—';

      return {
        machineId,
        deviceId,
        loomNumber: record.loom_number ?? existing?.loomNumber ?? null,
        family: record.family || existing?.family || 'OmniPlus-i',
        sources: record.sources || ['WT32-ETH01'],
        setRpm: record.set_rpm || 874,
        weftDensityPicksPerCm: weftDensity,
        ipAddress: resolvedIp,
        articleName: record.article_name || existing?.articleName || 'Standard Weave',
        state: effectiveState,
        stopCategory: live.stop_category || null,
        stopId: live.stop_id || null,
        since: live.since || new Date().toISOString(),
        rpm: effectiveRpm,
        connectionStatus: connStatus,
        picksDeltaShift,
        picksTotal: totalPicks,
        runMsShift,
        stopMsShift,
        offlineMsShift: 0,
        stopsShift,
        rpmAvgRunning: effectiveRpm > 0 ? effectiveRpm : (existing?.rpmAvgRunning ?? 0),
        efficiencyPercentage,
        metresWoven,
        cmpx,
        isLongStop,
        longStopDeclared: Boolean(live.operator_reason),
        operatorReasonCode: (live.operator_reason as OperatorReasonCode) || null,
        operatorReasonNote: live.operator_note || null,
        declaredBy: live.declared_by || null,
        lastUpdated: live.updated_at || lastHeartbeat || '',
        hardwareDiagnostics: hasPinValues
          ? {
              deviceId,
              firmwareVersion: resolvedFw,
              lanPhyStatus: connStatus === 'OFFLINE' ? 'LINK_DOWN' : 'CONNECTED',
              ipAddress: resolvedIp || '—',
              macAddress: deviceId,
              lastHeartbeat: lastHeartbeat || '',
              pins: {
                piStrt: Boolean(rawPins.piStrt),
                piPp: Boolean(rawPins.piPp),
                piWd: Boolean(rawPins.piWd),
                piFd: Boolean(rawPins.piFd),
                lastPulseTs: live.last_ts,
                rawPinHistory: Array.isArray(rawPins.rawPinHistory)
                  ? rawPins.rawPinHistory.map((item) => ({
                      pin: item.pin,
                      level: item.level ?? item.state ?? 0,
                      offsetMsFromStop: item.offsetMsFromStop ?? item.ms ?? 0,
                    }))
                  : undefined,
              },
              optocouplerPins: {
                piStrt: Boolean(rawPins.piStrt),
                piPp: Boolean(rawPins.piPp),
                piWd: Boolean(rawPins.piWd),
                piFd: Boolean(rawPins.piFd),
                lastPulseTs: live.last_ts,
                rawPinHistory: Array.isArray(rawPins.rawPinHistory)
                  ? rawPins.rawPinHistory.map((item) => ({
                      pin: item.pin,
                      level: item.level ?? item.state ?? 0,
                      offsetMsFromStop: item.offsetMsFromStop ?? item.ms ?? 0,
                    }))
                  : undefined,
              },
            }
          : undefined,
      };
    },
    [],
  );

  // Poll Local LAN State (/api/live/state)
  const pollLocalState = useCallback(async () => {
    try {
      const res = await fetch('/api/live/state', { cache: 'no-store' });
      if (!res.ok) throw new Error('Local LAN endpoint unreachable');
      const data = (await res.json()) as { looms?: RawLoomRecord[] };

      if (isMountedRef.current && data.looms) {
        setShiftStartKey(getActiveShiftInfo().startTimeUtc);
        setLooms((prev) => {
          const next = { ...prev };
          for (const item of data.looms ?? []) {
            next[item.machine_id] = mapRecordToLoomState(item, prev[item.machine_id]);
          }
          const activeIds = new Set((data.looms ?? []).map((l) => l.machine_id));
          for (const id of Object.keys(next)) {
            if (!activeIds.has(id)) {
              delete next[id];
            }
          }
          return next;
        });

        setSystemStatus((prev) => (prev === 'CLOUD_LIVE' ? 'CLOUD_LIVE' : 'LOCAL_LAN'));
      }
    } catch {
      if (isMountedRef.current) {
        setSystemStatus((prev) => (prev === 'CLOUD_LIVE' ? 'CLOUD_LIVE' : 'DISCONNECTED'));
      }
    }
  }, [mapRecordToLoomState]);

  const fetchSupabaseLooms = useCallback(async (): Promise<boolean> => {
    if (!isSupabaseEnabled || !supabase) {
      await pollLocalState();
      return false;
    }

    try {
      const client = supabase;
      const shift = getActiveShiftInfo();
      setShiftStartKey(shift.startTimeUtc);

      const fetchAllShiftCounters = async (): Promise<MinuteCounterRow[]> => {
        const pageSize = 1000;
        const maxPages = 50;
        const rows: MinuteCounterRow[] = [];
        for (let page = 0; page < maxPages; page++) {
          const from = page * pageSize;
          const to = from + pageSize - 1;
          const { data, error } = await client
            .from('loom_minute_counters')
            .select(
              'machine_id, picks_delta, run_ms, stop_ms, stops_warp, stops_filling, stops_selvedge, stops_other',
            )
            .gte('window_start', shift.startTimeUtc)
            .order('window_start', { ascending: true })
            .order('machine_id', { ascending: true })
            .range(from, to);
          if (error) return rows;
          if (!Array.isArray(data) || data.length === 0) break;
          rows.push(...(data as MinuteCounterRow[]));
          if (data.length < pageSize) break;
        }
        return rows;
      };

      const [loomsRes, counterRows, healthRes] = await Promise.all([
        client.from('looms').select('*, loom_live_state(*)'),
        fetchAllShiftCounters(),
        client.from('device_health').select('device_id, machine_id, ip_address, firmware_version'),
      ]);

      if (loomsRes.error) throw loomsRes.error;
      if (!isMountedRef.current) return false;

      const agg: Record<string, ShiftCounterAggregate> = {};
      for (const row of counterRows) {
        if (!agg[row.machine_id]) {
          agg[row.machine_id] = {
            runMs: 0,
            stopMs: 0,
            picksDelta: 0,
            stops: { WARP: 0, FILLING: 0, SELVEDGE: 0, OTHER: 0 },
          };
        }
        const entry = agg[row.machine_id];
        entry.runMs += Number(row.run_ms || 0);
        entry.stopMs += Number(row.stop_ms || 0);
        entry.picksDelta += Number(row.picks_delta || 0);
        entry.stops.WARP += Number(row.stops_warp || 0);
        entry.stops.FILLING += Number(row.stops_filling || 0);
        entry.stops.SELVEDGE += Number(row.stops_selvedge || 0);
        entry.stops.OTHER += Number(row.stops_other || 0);
      }
      shiftCountersRef.current = agg;

      if (!healthRes.error && Array.isArray(healthRes.data)) {
        const healthMap: Record<string, DeviceHealthRow> = {};
        const healthByMachine: Record<string, DeviceHealthRow> = {};
        for (const h of healthRes.data as DeviceHealthRow[]) {
          healthMap[h.device_id] = h;
          if (h.machine_id) {
            healthByMachine[h.machine_id] = h;
          }
        }
        deviceHealthRef.current = healthMap;
        deviceHealthByMachineRef.current = healthByMachine;
      }

      const dbLooms = (loomsRes.data || []) as RawLoomRecord[];
      setLooms((prev) => {
        const loomMap: Record<string, LoomClientState> = {};
        for (const item of dbLooms) {
          loomMap[item.machine_id] = mapRecordToLoomState(item, prev[item.machine_id]);
        }
        return loomMap;
      });
      setSystemStatus('CLOUD_LIVE');
      return true;
    } catch {
      if (isMountedRef.current) {
        setSystemStatus('DISCONNECTED');
      }
      return false;
    }
  }, [mapRecordToLoomState, pollLocalState]);

  // Primary: Connect to Supabase Realtime (if enabled) with fallback to Local LAN polling
  useEffect(() => {
    isMountedRef.current = true;

    if (!isSupabaseEnabled || !supabase) {
      const initTimer = setTimeout(() => {
        if (isMountedRef.current) void pollLocalState();
      }, 0);
      const pollTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        void pollLocalState();
      }, 1500);
      const onVisibility = () => {
        if (document.visibilityState === 'visible') void pollLocalState();
      };
      document.addEventListener('visibilitychange', onVisibility);
      return () => {
        isMountedRef.current = false;
        clearTimeout(initTimer);
        clearInterval(pollTimer);
        document.removeEventListener('visibilitychange', onVisibility);
      };
    }

    let realtimeStarted = false;

    const setupRealtimeSubscription = () => {
      try {
        detachRealtimeChannel();
        const client = supabase;
        if (!client) return;

        const channel = client
          .channel('public:loom_live_state')
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'loom_live_state' },
            (payload: RealtimePostgresChangesPayload<RawLiveStateRecord>) => {
              if (!isMountedRef.current) return;
              setSystemStatus('CLOUD_LIVE');

              if (payload.eventType === 'DELETE') {
                const oldLive = payload.old as RawLiveStateRecord | null;
                if (oldLive?.machine_id) {
                  void fetchSupabaseLooms();
                }
                return;
              }

              const newLive = payload.new as RawLiveStateRecord | null;
              if (newLive && newLive.machine_id) {
                const machineId = newLive.machine_id;
                let missingExisting = false;
                setLooms((prev) => {
                  const existing = prev[machineId];
                  if (!existing) {
                    missingExisting = true;
                    return prev;
                  }
                  const storedHeartbeat = lastHeartbeatRef.current[existing.machineId] ?? null;
                  const liveUpdated = newLive.updated_at || null;
                  const fresherHeartbeat =
                    liveUpdated &&
                    (!storedHeartbeat || Date.parse(liveUpdated) > Date.parse(storedHeartbeat))
                      ? liveUpdated
                      : storedHeartbeat;

                  const updated = mapRecordToLoomState(
                    {
                      machine_id: existing.machineId,
                      device_id: existing.deviceId,
                      loom_number: existing.loomNumber,
                      family: existing.family,
                      article_name: existing.articleName,
                      sources: existing.sources,
                      set_rpm: existing.setRpm,
                      weft_density_picks_per_cm: existing.weftDensityPicksPerCm,
                      ip_address: existing.ipAddress,
                      last_heartbeat_at: fresherHeartbeat,
                      loom_live_state: newLive,
                    },
                    existing,
                  );
                  return { ...prev, [machineId]: updated };
                });
                if (missingExisting) {
                  void fetchSupabaseLooms();
                }
              }
            },
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'looms' },
            () => {
              if (isMountedRef.current) {
                void fetchSupabaseLooms();
              }
            },
          )
          .subscribe((status: string) => {
            if (status === 'SUBSCRIBED') {
              if (isMountedRef.current) setSystemStatus('CLOUD_LIVE');
            } else if (status === 'CLOSED') {
              if (realtimeChannelRef.current === channel) {
                realtimeChannelRef.current = null;
                realtimeStarted = false;
              }
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              realtimeStarted = false;
              queueMicrotask(detachRealtimeChannel);
            }
          });

        realtimeChannelRef.current = channel;
      } catch {
        realtimeStarted = false;
      }
    };

    const syncOnce = async () => {
      const ok = await fetchSupabaseLooms();
      if (ok && !realtimeStarted && isMountedRef.current) {
        realtimeStarted = true;
        setupRealtimeSubscription();
      }
    };

    void syncOnce();
    const pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void syncOnce();
    }, 5000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncOnce();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      isMountedRef.current = false;
      clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      detachRealtimeChannel();
    };
  }, [detachRealtimeChannel, fetchSupabaseLooms, mapRecordToLoomState, pollLocalState]);

  const refreshTelemetry = useCallback(async () => {
    if (isSupabaseEnabled && supabase) {
      await fetchSupabaseLooms();
    } else {
      await pollLocalState();
    }
  }, [fetchSupabaseLooms, pollLocalState]);

  // Operational Action: Declare / Log Stop Reason
  const assignLongStopReason = useCallback(
    async (
      machineId: string,
      stopId: string | null,
      reasonCode: OperatorReasonCode,
      notes?: string,
      operatorName?: string,
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
            operatorName: operatorName || 'Floor Operator',
          }),
        });

        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error || 'Failed to declare stop reason');
        }

        toast.success(`Stop reason logged: ${OPERATOR_REASON_LABELS[reasonCode]}`);
        await refreshTelemetry();
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Error declaring stop reason';
        toast.error(message);
        return false;
      }
    },
    [refreshTelemetry],
  );

  // Operational Action: Configure / Label Connected Loom
  const configureLoomAction = useCallback(
    async (
      machineId: string,
      updates: {
        loomNumber?: number;
        family?: string;
        articleName?: string;
        setRpm?: number;
        weftDensity?: number;
      },
    ): Promise<boolean> => {
      try {
        const res = await fetch('/api/operator/configure-loom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ machineId, ...updates }),
        });

        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error || 'Failed to configure loom');
        }

        toast.success(`Loom ${machineId} configured successfully`);
        await refreshTelemetry();
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Error configuring loom';
        toast.error(message);
        return false;
      }
    },
    [refreshTelemetry],
  );

  // Dynamic Shift KPIs derived strictly from connected machines
  const shiftKpis = useMemo<ShiftKpiSummary>(() => {
    void shiftStartKey;
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

    const running = loomList.filter((l) => l.state === 'RUNNING');
    const stopped = loomList.filter((l) => l.state === 'STOPPED');
    const offline = loomList.filter((l) => l.state === 'OFFLINE');

    let sumRunMs = 0;
    let sumStopMs = 0;
    let totalPicks = 0;
    let totalMetres = 0;
    let totalStops = 0;
    const stopsByCategory = { WARP: 0, FILLING: 0, SELVEDGE: 0, OTHER: 0 };

    loomList.forEach((l) => {
      totalPicks += l.picksDeltaShift || l.picksTotal || 0;
      totalMetres += l.metresWoven || 0;
      sumRunMs += l.runMsShift || 0;
      sumStopMs += l.stopMsShift || 0;
      totalStops +=
        l.stopsShift.WARP +
        l.stopsShift.FILLING +
        l.stopsShift.SELVEDGE +
        l.stopsShift.OTHER;
      stopsByCategory.WARP += l.stopsShift.WARP;
      stopsByCategory.FILLING += l.stopsShift.FILLING;
      stopsByCategory.SELVEDGE += l.stopsShift.SELVEDGE;
      stopsByCategory.OTHER += l.stopsShift.OTHER;
    });

    const sumObservedMs = sumRunMs + sumStopMs;
    const averageEfficiency =
      sumObservedMs > 0 ? Number(((sumRunMs / sumObservedMs) * 100).toFixed(1)) : null;

    const avgRpm =
      running.length > 0
        ? Math.round(running.reduce((acc, l) => acc + l.rpm, 0) / running.length)
        : 0;

    const cmpxAverage =
      totalPicks > 0 ? Number(((totalStops / totalPicks) * 100000).toFixed(2)) : 0;

    const mtbfMinutes =
      totalStops > 0
        ? Math.round(sumRunMs / 60000 / totalStops)
        : sumRunMs > 0
          ? Math.round(sumRunMs / 60000)
          : 0;
    const mttrMinutes =
      totalStops > 0 ? Math.round(sumStopMs / 60000 / totalStops) : 0;

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
      mtbfMinutes,
      mttrMinutes,
      stopsByCategory,
    };
  }, [looms, shiftStartKey]);

  const connectionStatus =
    systemStatus === 'CLOUD_LIVE'
      ? 'CONNECTED_REALTIME'
      : systemStatus === 'CONNECTING'
        ? 'CONNECTING'
        : 'EDGE_GATEWAY_BUS';

  return (
    <TelemetryContext.Provider
      value={{
        looms,
        selectedMachineId,
        setSelectedMachineId,
        systemStatus,
        connectionStatus,
        shiftKpis,
        assignLongStopReason,
        configureLoom: configureLoomAction,
        refreshTelemetry,
      }}
    >
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
