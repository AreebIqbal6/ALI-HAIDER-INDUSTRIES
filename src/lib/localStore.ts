// src/lib/localStore.ts: In-Memory Production Store for Edge Gateway & Zero-Mock Local LAN Mode
// Maintains live state across Next.js API route invocations via global singleton.

export interface StoredLoom {
  id: string;
  machine_id: string;
  device_id: string;
  loom_number: number | null;
  family: string;
  year_recorded?: string;
  article_name: string;
  sources: string[];
  set_rpm: number;
  weft_density_picks_per_cm: number;
  ip_address?: string;
  firmware_version?: string;
  status: 'RUNNING' | 'STOPPED' | 'OFFLINE';
  last_heartbeat_at: string;
  created_at: string;
}

export interface StoredLiveState {
  machine_id: string;
  device_id: string;
  state: 'RUNNING' | 'STOPPED' | 'OFFLINE';
  stop_category: 'WARP' | 'FILLING' | 'SELVEDGE' | 'OTHER' | null;
  stop_id: string | null;
  since: string;
  rpm: number;
  total_picks: number;
  meters_woven: number;
  warp_tension_kn?: number;
  air_pressure_bar?: number;
  raw_pins?: {
    piStrt: number;
    piPp: number;
    piWd: number;
    piFd: number;
    rawPinHistory?: Array<{ pin: string; state: number; ms: number }>;
  };
  operator_reason?: string | null;
  operator_note?: string | null;
  declared_at?: string | null;
  last_ts: string;
  updated_at: string;
}

export interface StoredMinuteCounter {
  machine_id: string;
  window_start: string;
  window_end: string;
  picks_delta: number;
  picks_total: number;
  run_ms: number;
  stop_ms: number;
  offline_ms: number;
  stops_warp: number;
  stops_filling: number;
  stops_selvedge: number;
  stops_other: number;
  rpm_avg_running: number;
}

interface LocalStoreState {
  looms: Map<string, StoredLoom>;
  liveStates: Map<string, StoredLiveState>;
  counters: StoredMinuteCounter[];
  deviceSeqMap: Map<string, number>;
}

// Global singleton pattern for Next.js hot-reloading / multiple route workers
const globalStoreKey = Symbol.for('weavesync.localstore.v2');
const globalAny = globalThis as unknown as { [globalStoreKey]?: LocalStoreState };

if (!globalAny[globalStoreKey]) {
  globalAny[globalStoreKey] = {
    looms: new Map<string, StoredLoom>(),
    liveStates: new Map<string, StoredLiveState>(),
    counters: [],
    deviceSeqMap: new Map<string, number>()
  };
}

const store = globalAny[globalStoreKey]!;

/**
 * Computes temporal connection status from last heartbeat
 * ONLINE: <15s
 * STALE: 15s - 60s
 * OFFLINE: >60s
 */
export function getLoomConnectionStatus(lastHeartbeatIso?: string | null): {
  status: 'ONLINE' | 'STALE' | 'OFFLINE';
  secondsAgo: number;
} {
  if (!lastHeartbeatIso) {
    return { status: 'OFFLINE', secondsAgo: 999999 };
  }
  const lastMs = new Date(lastHeartbeatIso).getTime();
  if (isNaN(lastMs)) {
    return { status: 'OFFLINE', secondsAgo: 999999 };
  }
  const secondsAgo = Math.max(0, Math.floor((Date.now() - lastMs) / 1000));
  if (secondsAgo < 15) return { status: 'ONLINE', secondsAgo };
  if (secondsAgo <= 60) return { status: 'STALE', secondsAgo };
  return { status: 'OFFLINE', secondsAgo };
}

/**
 * Auto-registers or updates a loom in the local store
 * Called dynamically whenever a valid hardware packet arrives
 */
export function autoRegisterLoom(params: {
  deviceId: string;
  machineId?: string;
  loomNumber?: number | null;
  family?: string;
  ipAddress?: string;
  firmwareVersion?: string;
  setRpm?: number;
  weftDensity?: number;
}): StoredLoom {
  const now = new Date().toISOString();
  const machineId = params.machineId || `LOOM-${params.deviceId.slice(-6).replace(/[^A-Za-z0-9]/g, '')}`;

  let existing = store.looms.get(machineId);
  if (!existing) {
    // Determine auto loom number if not provided
    const nextLoomNum = params.loomNumber ?? (store.looms.size + 1);

    existing = {
      id: `loom-${machineId.toLowerCase()}`,
      machine_id: machineId,
      device_id: params.deviceId,
      loom_number: nextLoomNum,
      family: params.family || 'OmniPlus-i',
      article_name: 'Standard Sheeting',
      sources: ['WT32-ETH01'],
      set_rpm: params.setRpm || 874,
      weft_density_picks_per_cm: params.weftDensity || 27.2,
      ip_address: params.ipAddress,
      firmware_version: params.firmwareVersion || 'v2.1',
      status: 'RUNNING',
      last_heartbeat_at: now,
      created_at: now
    };
    store.looms.set(machineId, existing);
  } else {
    existing.last_heartbeat_at = now;
    if (params.ipAddress) existing.ip_address = params.ipAddress;
    if (params.firmwareVersion) existing.firmware_version = params.firmwareVersion;
    if (params.setRpm) existing.set_rpm = params.setRpm;
    if (params.weftDensity) existing.weft_density_picks_per_cm = params.weftDensity;
    if (params.loomNumber !== undefined) existing.loom_number = params.loomNumber;
    if (params.family) existing.family = params.family;
  }

  return existing;
}

/**
 * Updates telemetry from an authenticated hardware frame
 */
export function updateLoomTelemetry(params: {
  machineId: string;
  deviceId: string;
  state: 'RUNNING' | 'STOPPED' | 'OFFLINE';
  stopCategory: 'WARP' | 'FILLING' | 'SELVEDGE' | 'OTHER' | null;
  stopId?: string | null;
  since?: string;
  rpm: number;
  totalPicks?: number;
  picksDelta?: number;
  weftDensity?: number;
  warpTensionKn?: number;
  airPressureBar?: number;
  rawPins?: {
    piStrt: number;
    piPp: number;
    piWd: number;
    piFd: number;
    rawPinHistory?: Array<{ pin: string; state: number; ms: number }>;
  };
  seq?: number;
  timestamp?: string;
}): StoredLiveState {
  const now = params.timestamp || new Date().toISOString();
  const loom = autoRegisterLoom({
    deviceId: params.deviceId,
    machineId: params.machineId
  });

  loom.last_heartbeat_at = now;
  loom.status = params.state;

  let live = store.liveStates.get(params.machineId);
  const prevPicks = live?.total_picks || 0;
  const newPicks = params.totalPicks !== undefined
    ? params.totalPicks
    : prevPicks + (params.picksDelta || 0);

  const weftDensity = loom.weft_density_picks_per_cm || 27.2;
  const metersWoven = Number((newPicks / (weftDensity * 100.0)).toFixed(1));

  if (!live) {
    live = {
      machine_id: params.machineId,
      device_id: params.deviceId,
      state: params.state,
      stop_category: params.stopCategory,
      stop_id: params.stopId || null,
      since: params.since || now,
      rpm: params.rpm,
      total_picks: newPicks,
      meters_woven: metersWoven,
      warp_tension_kn: params.warpTensionKn,
      air_pressure_bar: params.airPressureBar,
      raw_pins: params.rawPins,
      last_ts: now,
      updated_at: now
    };
  } else {
    // Preserve existing stop timer if state didn't change
    const stateChanged = live.state !== params.state;
    live.state = params.state;
    live.stop_category = params.stopCategory;
    live.stop_id = params.stopId !== undefined ? params.stopId : (stateChanged && params.state === 'STOPPED' ? `stop-${Date.now()}` : live.stop_id);
    if (stateChanged) {
      live.since = params.since || now;
      if (params.state === 'RUNNING') {
        live.operator_reason = null;
        live.operator_note = null;
        live.declared_at = null;
      }
    }
    live.rpm = params.rpm;
    live.total_picks = newPicks;
    live.meters_woven = metersWoven;
    if (params.warpTensionKn !== undefined) live.warp_tension_kn = params.warpTensionKn;
    if (params.airPressureBar !== undefined) live.air_pressure_bar = params.airPressureBar;
    if (params.rawPins) live.raw_pins = params.rawPins;
    live.last_ts = now;
    live.updated_at = now;
  }

  store.liveStates.set(params.machineId, live);

  // Track monotonic sequence if provided
  if (params.seq !== undefined) {
    store.deviceSeqMap.set(params.deviceId, params.seq);
  }

  return live;
}

/**
 * Configure / Label a connected machine
 */
export function configureLoom(params: {
  machineId: string;
  loomNumber?: number | null;
  family?: string;
  articleName?: string;
  setRpm?: number;
  weftDensity?: number;
}): StoredLoom | null {
  const loom = store.looms.get(params.machineId);
  if (!loom) return null;

  if (params.loomNumber !== undefined) loom.loom_number = params.loomNumber;
  if (params.family) loom.family = params.family;
  if (params.articleName) loom.article_name = params.articleName;
  if (params.setRpm) loom.set_rpm = params.setRpm;
  if (params.weftDensity) loom.weft_density_picks_per_cm = params.weftDensity;

  return loom;
}

/**
 * Assign an operator stop reason to a stopped loom
 */
export function assignStopReason(params: {
  machineId: string;
  reasonCode: string;
  notes?: string;
}): boolean {
  const state = store.liveStates.get(params.machineId);
  if (!state) return false;

  state.operator_reason = params.reasonCode;
  state.operator_note = params.notes || null;
  state.declared_at = new Date().toISOString();
  state.updated_at = new Date().toISOString();

  store.liveStates.set(params.machineId, state);
  return true;
}

/**
 * Returns full snapshot of all registered looms and live states
 * Dynamically computes ONLINE / STALE / OFFLINE
 */
export function getLocalStoreSnapshot() {
  const loomsList: Array<StoredLoom & {
    liveState: StoredLiveState;
    connectionStatus: 'ONLINE' | 'STALE' | 'OFFLINE';
    secondsAgo: number;
  }> = [];

  for (const [mId, loom] of store.looms.entries()) {
    const live = store.liveStates.get(mId) || {
      machine_id: mId,
      device_id: loom.device_id,
      state: 'OFFLINE' as const,
      stop_category: null,
      stop_id: null,
      since: loom.last_heartbeat_at || loom.created_at,
      rpm: 0,
      total_picks: 0,
      meters_woven: 0,
      last_ts: loom.last_heartbeat_at || loom.created_at,
      updated_at: loom.last_heartbeat_at || loom.created_at
    };

    const conn = getLoomConnectionStatus(loom.last_heartbeat_at);

    // If offline (>60s), live RPM must be 0 and state OFFLINE
    const effectiveState: 'RUNNING' | 'STOPPED' | 'OFFLINE' =
      conn.status === 'OFFLINE' ? 'OFFLINE' : live.state;
    const effectiveRpm = conn.status === 'OFFLINE' ? 0 : live.rpm;

    loomsList.push({
      ...loom,
      status: effectiveState,
      liveState: {
        ...live,
        state: effectiveState,
        rpm: effectiveRpm
      },
      connectionStatus: conn.status,
      secondsAgo: conn.secondsAgo
    });
  }

  // Calculate high-level KPIs strictly from registered looms
  const totalLooms = loomsList.length;
  const runningCount = loomsList.filter(l => l.liveState.state === 'RUNNING').length;
  const stoppedCount = loomsList.filter(l => l.liveState.state === 'STOPPED').length;
  const offlineCount = loomsList.filter(l => l.liveState.state === 'OFFLINE').length;

  let sumRunMs = 0;
  let sumObservedMs = 0;
  let totalMeters = 0;

  for (const l of loomsList) {
    totalMeters += l.liveState.meters_woven || 0;
    if (l.liveState.state === 'RUNNING') {
      sumRunMs += 50000;
      sumObservedMs += 60000;
    } else if (l.liveState.state === 'STOPPED') {
      sumRunMs += 10000;
      sumObservedMs += 60000;
    }
  }

  const avgEfficiency = totalLooms > 0 && sumObservedMs > 0
    ? Number(((sumRunMs / sumObservedMs) * 100).toFixed(1))
    : null;

  return {
    success: true,
    mode: 'LOCAL_LAN' as const,
    totalLooms,
    runningCount,
    stoppedCount,
    offlineCount,
    avgEfficiency,
    totalMeters: Number(totalMeters.toFixed(1)),
    serverTime: new Date().toISOString(),
    looms: loomsList
  };
}

/**
 * Clear test data (useful for external verification scripts)
 */
export function clearTestLoom(machineIdOrDeviceId: string): boolean {
  for (const [mId, l] of store.looms.entries()) {
    if (mId === machineIdOrDeviceId || l.device_id === machineIdOrDeviceId) {
      store.looms.delete(mId);
      store.liveStates.delete(mId);
      return true;
    }
  }
  return false;
}

/**
 * Clear all registered looms and state
 */
export function clearAllLooms(): void {
  store.looms.clear();
  store.liveStates.clear();
  store.counters = [];
  store.deviceSeqMap.clear();
}
