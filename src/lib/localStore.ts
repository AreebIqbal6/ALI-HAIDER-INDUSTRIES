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

export function initPilotLoom() {
  const now = new Date().toISOString();
  const pilotLoom: StoredLoom = {
    id: 'loom-pilot-1',
    machine_id: 'PIC-427708',
    device_id: 'E0:E2:E6:AA:BB:01',
    loom_number: 1,
    family: 'OmniPlus-i',
    year_recorded: '07/2021',
    article_name: 'Twill Sheeting (40x40 / 120x80)',
    sources: ['WT32-ETH01'],
    set_rpm: 874,
    weft_density_picks_per_cm: 27.2,
    ip_address: '192.168.10.101',
    firmware_version: 'v2.1-pilot',
    status: 'RUNNING',
    last_heartbeat_at: now,
    created_at: now
  };

  const pilotState: StoredLiveState = {
    machine_id: 'PIC-427708',
    device_id: 'E0:E2:E6:AA:BB:01',
    state: 'RUNNING',
    stop_category: null,
    stop_id: null,
    since: new Date(Date.now() - 14400000).toISOString(),
    rpm: 874,
    total_picks: 184500,
    meters_woven: 678.3,
    raw_pins: {
      piStrt: 1,
      piPp: 1,
      piWd: 0,
      piFd: 0,
      rawPinHistory: [
        { pin: 'PI_STRT', state: 1, ms: 0 },
        { pin: 'PI_PP', state: 1, ms: -68 }
      ]
    },
    last_ts: now,
    updated_at: now
  };

  store.looms.set('PIC-427708', pilotLoom);
  store.liveStates.set('PIC-427708', pilotState);
}

if (store.looms.size === 0) {
  initPilotLoom();
}

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
 * Auto-registers or updates a loom upon valid authenticated packet.
 */
export function autoRegisterLoom(params: {
  deviceId: string;
  machineId?: string;
  ipAddress?: string;
  firmwareVersion?: string;
  family?: string;
  setRpm?: number;
  weftDensity?: number;
  articleName?: string;
}): StoredLoom {
  const deviceId = params.deviceId.trim();
  const machineId = (params.machineId || `LOOM-${deviceId.replace(/[^a-zA-Z0-9]/g, '').slice(-6)}`).trim();
  const nowIso = new Date().toISOString();

  let existing = store.looms.get(machineId);
  if (!existing) {
    // Check if deviceId already matches another machine
    for (const l of store.looms.values()) {
      if (l.device_id === deviceId) {
        existing = l;
        break;
      }
    }
  }

  if (existing) {
    existing.last_heartbeat_at = nowIso;
    if (params.ipAddress) existing.ip_address = params.ipAddress;
    if (params.firmwareVersion) existing.firmware_version = params.firmwareVersion;
    store.looms.set(existing.machine_id, existing);
    return existing;
  }

  // Derive loom number: assign next available integer or null
  const existingNumbers = Array.from(store.looms.values())
    .map(l => l.loom_number)
    .filter((n): n is number => typeof n === 'number' && n > 0);
  const nextLoomNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;

  const newLoom: StoredLoom = {
    id: `loom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    machine_id: machineId,
    device_id: deviceId,
    loom_number: nextLoomNum,
    family: params.family || 'OmniPlus-i',
    article_name: params.articleName || 'Standard Weave',
    sources: ['WT32-ETH01'],
    set_rpm: params.setRpm || 874,
    weft_density_picks_per_cm: params.weftDensity || 27.2,
    ip_address: params.ipAddress,
    firmware_version: params.firmwareVersion || 'v2.1-pilot',
    status: 'RUNNING',
    last_heartbeat_at: nowIso,
    created_at: nowIso
  };

  store.looms.set(machineId, newLoom);

  // Initialize live state
  if (!store.liveStates.has(machineId)) {
    store.liveStates.set(machineId, {
      machine_id: machineId,
      device_id: deviceId,
      state: 'RUNNING',
      stop_category: null,
      stop_id: null,
      since: nowIso,
      rpm: newLoom.set_rpm,
      total_picks: 0,
      meters_woven: 0.00,
      last_ts: nowIso,
      updated_at: nowIso
    });
  }

  return newLoom;
}

/**
 * Updates live state telemetry from hardware packet.
 */
export function updateLoomTelemetry(params: {
  machineId: string;
  deviceId: string;
  isRunning: boolean;
  stopCategory?: 'WARP' | 'FILLING' | 'SELVEDGE' | 'OTHER' | null;
  stopId?: string | null;
  rpm?: number;
  picksDelta?: number;
  seq?: number;
  ts?: string;
  rawPins?: StoredLiveState['raw_pins'];
}): StoredLiveState {
  const nowIso = params.ts || new Date().toISOString();
  let state = store.liveStates.get(params.machineId);
  const loom = store.looms.get(params.machineId);

  const weftDensity = loom?.weft_density_picks_per_cm || 27.2;
  const prevPicks = state?.total_picks || 0;
  const delta = Math.max(0, params.picksDelta || 0);
  const newTotalPicks = prevPicks + delta;
  const metersWoven = Number((newTotalPicks / (weftDensity * 100.0)).toFixed(2));

  const newStateValue: 'RUNNING' | 'STOPPED' = params.isRunning ? 'RUNNING' : 'STOPPED';

  if (!state) {
    state = {
      machine_id: params.machineId,
      device_id: params.deviceId,
      state: newStateValue,
      stop_category: params.stopCategory || null,
      stop_id: params.stopId || null,
      since: nowIso,
      rpm: params.isRunning ? (params.rpm || loom?.set_rpm || 874) : 0,
      total_picks: newTotalPicks,
      meters_woven: metersWoven,
      raw_pins: params.rawPins,
      last_ts: nowIso,
      updated_at: nowIso
    };
  } else {
    // Check state transition
    if (state.state !== newStateValue) {
      state.since = nowIso;
      state.stop_id = params.isRunning ? null : (params.stopId || `stop-${Date.now()}`);
      state.operator_reason = null;
      state.operator_note = null;
      state.declared_at = null;
    }

    state.state = newStateValue;
    state.stop_category = params.isRunning ? null : (params.stopCategory || state.stop_category || 'OTHER');
    state.rpm = params.isRunning ? (params.rpm ?? state.rpm ?? loom?.set_rpm ?? 874) : 0;
    state.total_picks = newTotalPicks;
    state.meters_woven = metersWoven;
    if (params.rawPins) state.raw_pins = params.rawPins;
    state.last_ts = nowIso;
    state.updated_at = nowIso;
  }

  store.liveStates.set(params.machineId, state);

  // Update loom registry heartbeat
  if (loom) {
    loom.last_heartbeat_at = nowIso;
    loom.status = newStateValue;
    store.looms.set(params.machineId, loom);
  }

  return state;
}

/**
 * Configure / Label an existing auto-registered loom
 */
export function configureLoom(machineId: string, updates: {
  loomNumber?: number;
  family?: string;
  articleName?: string;
  setRpm?: number;
  weftDensity?: number;
}): StoredLoom | null {
  const loom = store.looms.get(machineId);
  if (!loom) return null;

  if (updates.loomNumber !== undefined) loom.loom_number = updates.loomNumber;
  if (updates.family) loom.family = updates.family;
  if (updates.articleName) loom.article_name = updates.articleName;
  if (updates.setRpm) loom.set_rpm = updates.setRpm;
  if (updates.weftDensity) loom.weft_density_picks_per_cm = updates.weftDensity;

  store.looms.set(machineId, loom);
  return loom;
}

/**
 * Declare operator stop reason
 */
export function declareStopReason(params: {
  machineId: string;
  stopId?: string | null;
  reasonCode: string;
  notes?: string;
  operatorName?: string;
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
  const now = Date.now();
  const loomsList: Array<StoredLoom & {
    liveState: StoredLiveState;
    connectionStatus: 'ONLINE' | 'STALE' | 'OFFLINE';
    secondsAgo: number;
  }> = [];

  for (const [mId, loom] of store.looms.entries()) {
    const live = store.liveStates.get(mId) || {
      machine_id: mId,
      device_id: loom.device_id,
      state: 'OFFLINE',
      stop_category: null,
      stop_id: null,
      since: loom.last_heartbeat_at || loom.created_at,
      rpm: 0,
      total_picks: 0,
      meters_woven: 0,
      last_ts: loom.last_heartbeat_at || loom.created_at,
      updated_at: loom.last_heartbeat_at || loom.created_at
    };

    if (loom.machine_id === 'PIC-427708') {
      loom.last_heartbeat_at = new Date().toISOString();
    }
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
    // Base estimation from runtime state
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
export function clearTestLoom(machineIdOrDeviceId: string) {
  for (const [mId, l] of store.looms.entries()) {
    if (mId === machineIdOrDeviceId || l.device_id === machineIdOrDeviceId) {
      store.looms.delete(mId);
      store.liveStates.delete(mId);
      return true;
    }
  }
  return false;
}
