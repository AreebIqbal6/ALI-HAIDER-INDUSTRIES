// src/types/index.ts: Production Data Contract & Envelopes for WeaveSync SCADA
// Strict Zero-Mock SCADA Specification (Ali Haider Industries)

export type SourceKind = 
  | 'WT32-ETH01' 
  | 'EDGE_GATEWAY' 
  | 'BICOM_ETH' 
  | 'HARDWARE'
  | 'SENSOR_KIT'
  | 'LDL';

export type StopCategory = 'WARP' | 'FILLING' | 'SELVEDGE' | 'OTHER';

export type LoomStateKind = 'RUNNING' | 'STOPPED' | 'OFFLINE' | 'UNKNOWN';

// Operator Reason Codes for Long Stops (> 5 minutes)
export type OperatorReasonCode = 
  | 'ART'  // Article Change
  | 'KNT'  // Knotting
  | 'ELE'  // Electrical Breakdown
  | 'MEC'  // Mechanical Breakdown
  | 'BST'  // Beam Gaiting (BST)
  | 'DOF'  // Cloth Doffing
  | 'OLS'; // Other Long Stop

export const OPERATOR_REASON_LABELS: Record<OperatorReasonCode, string> = {
  ART: 'Article Change (ART)',
  KNT: 'Knotting (KNT)',
  ELE: 'Electrical Breakdown (ELE)',
  MEC: 'Mechanical Breakdown (MEC)',
  BST: 'Beam Gaiting (BST)',
  DOF: 'Cloth Doffing (DOF)',
  OLS: 'Other Long Stop (OLS)',
};

export type LoomFamily = 'OmniPlus-i' | 'OmniPlus Summum' | 'OmniPlus 800' | 'Toyota JAT810';

export type SchemaVersion = 
  | 'ahi.loom.state/1.0'
  | 'ahi.loom.event/1.0'
  | 'ahi.loom.counters/1.0'
  | 'ahi.loom.process/1.0'
  | 'ahi.device.health/1.0'
  | 'ahi.gateway.health/1.0';

// Canonical Message Envelope
export interface CanonicalEnvelope<T = unknown> {
  schema: SchemaVersion;
  msgId: string;
  seq: number;
  machineId: string | null;
  gatewayId: string;
  source: SourceKind;
  deviceId: string | null;
  ts: string;
  tsQuality?: 'SYNCED' | 'ESTIMATED';
  replayed?: boolean;
  /** Contract v1: increments on every logger boot; seq restarts at 1 each boot. */
  bootId?: number;
  data: T;
}

/** Contract v1 event types (ahi.loom.event/1.0). */
export type LoomEventType =
  | 'STOP_STARTED'
  | 'STOP_ENDED'
  | 'START_ATTEMPT_FAILED'
  | 'COUNTER_DISCONTINUITY';

export interface LoomStateData {
  state: LoomStateKind;
  stopCategory: StopCategory | null;
  stopId: string | null;
  since: string;
  rpm: number;
  picksTotal?: number;
}

export interface StopStartedEventData {
  eventType: 'STOP_STARTED';
  stopId: string;
  stopCategory: StopCategory;
  detectedAt: string;
  picksTotal?: number;
}

export interface StopEndedEventData {
  eventType: 'STOP_ENDED';
  stopId: string;
  stopCategory: StopCategory;
  durationMs: number;
  failedStartAttempts: number;
  resolvedBy?: string;
  operatorReason?: OperatorReasonCode | null;
  picksTotal?: number;
}

export interface StartAttemptFailedEventData {
  eventType: 'START_ATTEMPT_FAILED';
  stopId?: string | null;
  stopCategory?: StopCategory | null;
  detectedAt?: string | null;
  failedStartAttempts?: number | null;
  picksTotal?: number | null;
}

export interface CounterDiscontinuityEventData {
  eventType: 'COUNTER_DISCONTINUITY';
  detectedAt?: string | null;
  picksTotal?: number | null;
}

export type LoomEventData =
  | StopStartedEventData
  | StopEndedEventData
  | StartAttemptFailedEventData
  | CounterDiscontinuityEventData;

export interface LoomCountersData {
  windowStart: string;
  windowEnd: string;
  picksDelta: number;
  picksTotal: number;
  runMs: number;
  stopMs: number;
  offlineMs: number;
  stops?: {
    WARP: number;
    FILLING: number;
    SELVEDGE: number;
    OTHER: number;
  };
  rpmAvgRunning: number;
}

export interface LoomProcessData {
  warpTensionKn?: number;
  airPressureBar?: number;
}

export interface GatewayHealthData {
  gatewayId: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  connectedDevices: number;
  activeLoomCount?: number;
  cpuLoadPercent?: number;
  memoryUsedMb?: number;
  bufferQueueSize?: number;
  uptimeSeconds: number;
}

export interface DeviceHealthData {
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | (string & {});
  ipAddress?: string | null;
  firmwareVersion?: string | null;
  uptimeSeconds: number;
  lastError?: string | null;
  // Contract v1 logger fields (optional for backwards compatibility)
  bootId?: number;
  bufferType?: string;
  bufferBacklog?: number;
  clockSynced?: boolean;
  linkUp?: boolean;
}

export interface HardwarePinHistoryItem {
  pin: string;
  level: number;
  offsetMsFromStop: number;
}

export interface HardwareDiagnostics {
  deviceId: string;
  firmwareVersion: string;
  lanPhyStatus: 'CONNECTED' | 'LINK_DOWN' | 'CONNECTED_100MBPS';
  ipAddress: string;
  macAddress: string;
  lastHeartbeat: string;
  isPilotNode?: boolean;
  pins?: {
    piStrt: boolean;
    piPp: boolean;
    piWd: boolean;
    piFd: boolean;
    lastPulseTs?: string;
    rawPinHistory?: HardwarePinHistoryItem[];
  };
  optocouplerPins?: {
    piStrt: boolean;
    piPp: boolean;
    piWd: boolean;
    piFd: boolean;
    piLd?: boolean;
    lastPulseTs?: string;
    rawPinHistory?: HardwarePinHistoryItem[];
  };
}

// Unified Client Model for UI Components
export interface LoomClientState {
  machineId: string;
  deviceId?: string;
  loomNumber: number | null;
  family: string;
  sources: string[];
  setRpm: number;
  weftDensityPicksPerCm: number;
  ipAddress?: string;
  articleName?: string;
  isPilotNode?: boolean;
  
  // Real-time State
  state: LoomStateKind;
  stopCategory: StopCategory | null;
  stopId: string | null;
  since: string;
  rpm: number;
  connectionStatus: 'ONLINE' | 'STALE' | 'OFFLINE';
  
  // Shift Counters & Production
  picksDeltaShift: number;
  picksTotal: number;
  runMsShift: number;
  stopMsShift: number;
  offlineMsShift: number;
  stopsShift: {
    WARP: number;
    FILLING: number;
    SELVEDGE: number;
    OTHER: number;
  };
  rpmAvgRunning: number;
  /** null when no measured run/stop time exists yet (UI renders "—") */
  efficiencyPercentage: number | null;
  metresWoven: number;
  cmpx: number;
  
  // Hardware Diagnostics (Only real telemetry)
  hardwareDiagnostics?: HardwareDiagnostics;

  // Stoppage Reason Logging
  isLongStop: boolean;
  longStopDeclared: boolean;
  operatorReasonCode?: OperatorReasonCode | null;
  operatorReasonNote?: string | null;
  declaredBy?: string | null;
  
  lastUpdated: string;
}

// Shift Information (PKT 12-Hour shifts)
export type ShiftType = 'SHIFT_A' | 'SHIFT_B';

export interface ShiftInfo {
  type: ShiftType;
  name: string; // "Shift A (08:00–20:00 PKT)" or "Shift B (20:00–08:00 PKT)"
  startTimeUtc: string;
  endTimeUtc: string;
  elapsedMs: number;
  totalDurationMs: number;
}

export interface ShiftKpiSummary {
  shift: ShiftInfo;
  averageEfficiency: number | null;
  averageRpm: number;
  totalPicks: number;
  totalMetresWoven: number;
  activeLoomsCount: number;
  totalLoomsCount: number;
  stoppedLoomsCount: number;
  offlineLoomsCount: number;
  totalStops: number;
  cmpxAverage: number;
  mtbfMinutes: number;
  mttrMinutes: number;
  stopsByCategory: {
    WARP: number;
    FILLING: number;
    SELVEDGE: number;
    OTHER: number;
  };
}

export type SystemStatusMode = 'CLOUD_LIVE' | 'LOCAL_LAN' | 'DISCONNECTED';

export interface TelemetryContextType {
  looms: Record<string, LoomClientState>;
  selectedMachineId: string | 'GLOBAL';
  setSelectedMachineId: (id: string | 'GLOBAL') => void;
  systemStatus: SystemStatusMode;
  connectionStatus: 'CONNECTED_REALTIME' | 'EDGE_GATEWAY_BUS' | 'CONNECTING';
  shiftKpis: ShiftKpiSummary;
  
  // Real Operational Actions
  assignLongStopReason: (
    machineId: string, 
    stopId: string | null, 
    reasonCode: OperatorReasonCode, 
    notes?: string, 
    operatorName?: string
  ) => Promise<boolean>;
  
  configureLoom: (
    machineId: string,
    updates: {
      loomNumber?: number;
      family?: string;
      articleName?: string;
      setRpm?: number;
      weftDensity?: number;
    }
  ) => Promise<boolean>;
  
  refreshTelemetry: () => Promise<void>;
}
