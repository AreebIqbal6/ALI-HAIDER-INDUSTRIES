// Section 10: Data Contract v1 - Types & Envelopes for WeaveSync SCADA (Ali Haider Industries)
// Strict Zero-Mock SCADA Specification

export type SourceKind = 
  | 'WT32-ETH01' 
  | 'EDGE_GATEWAY' 
  | 'BICOM_ETH' 
  | 'HARDWARE'
  | 'SENSOR_KIT';

export type StopCategory = 'WARP' | 'FILLING' | 'SELVEDGE' | 'OTHER';

export type LoomStateKind = 'RUNNING' | 'STOPPED' | 'OFFLINE' | 'UNKNOWN';

// Section 10.4: Operator Reason Codes for Long Stops (> 5 minutes)
export type OperatorReasonCode = 
  | 'ART'  // Article Change
  | 'KNT'  // Knotting
  | 'ELE'  // Electrical
  | 'MEC'  // Mechanical
  | 'BST'  // Beam Stop
  | 'DOF'  // Doffing
  | 'OLS'; // Other Long Stop

export const OPERATOR_REASON_LABELS: Record<OperatorReasonCode, string> = {
  ART: 'Article Change',
  KNT: 'Knotting',
  ELE: 'Electrical Breakdown',
  MEC: 'Mechanical Breakdown',
  BST: 'Beam Gaiting (BST)',
  DOF: 'Cloth Doffing',
  OLS: 'Other Long Stop',
};

export type LoomFamily = 'OmniPlus-i' | 'OmniPlus Summum' | 'OmniPlus 800';

export type SchemaVersion = 
  | 'ahi.loom.state/1.0'
  | 'ahi.loom.event/1.0'
  | 'ahi.loom.counters/1.0'
  | 'ahi.loom.process/1.0'
  | 'ahi.device.health/1.0'
  | 'ahi.gateway.health/1.0'
  | 'ahi.registry/1.0';

// Canonical Message Envelope (Section 10.2)
export interface CanonicalEnvelope<T = unknown> {
  schema: SchemaVersion;
  msgId: string;
  seq: number;
  machineId: string | null;
  gatewayId: string;
  source: SourceKind;
  deviceId: string | null;
  ts: string;
  tsQuality: 'SYNCED' | 'ESTIMATED';
  replayed: boolean;
  data: T;
}

// 1. State Payload (`ahi.loom.state/1.0`)
export interface LoomStateData {
  state: LoomStateKind;
  stopCategory: StopCategory | null;
  stopId: string | null;
  since: string;
  rpm: number;
}

// 2. Event Payload (`ahi.loom.event/1.0`)
export type LoomEventType = 
  | 'STOP_STARTED'
  | 'STOP_ENDED'
  | 'ALARM_RAISED'
  | 'COUNTER_DISCONTINUITY'
  | 'SOURCE_DISCREPANCY';

export interface StopStartedEventData {
  eventType: 'STOP_STARTED';
  stopId: string;
  stopCategory: StopCategory;
  rawStopCode?: string;
  rpmAtStop: number;
  picksAtStop: number;
}

export interface StopEndedEventData {
  eventType: 'STOP_ENDED';
  stopId: string;
  stopCategory: StopCategory;
  durationMs: number;
  failedStartAttempts: number;
  resolvedBy?: string;
  operatorReason?: OperatorReasonCode | null;
}

// 3. Counter Windows (`ahi.loom.counters/1.0`)
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
  uptimeSeconds?: number;
}

export interface DeviceHealthData {
  deviceId: string;
  status: 'ONLINE' | 'OFFLINE';
  firmwareVersion: string;
  ipAddress: string;
  rssi?: number;
  freeHeapBytes?: number;
  uptimeSeconds: number;
}

// Hardware Diagnostics (Real XP_CBMP_P9 optocoupler telemetry)
export interface PinTransitionEvent {
  pin: string;
  level: number;
  offsetMsFromStop?: number;
  timestampMs?: number;
}

export interface ParallelPinState {
  piStrt: boolean;
  piPp: boolean;
  piWd: boolean;
  piFd: boolean;
  piLd?: boolean;
  lastPulseTs?: string;
  rawPinHistory?: PinTransitionEvent[];
}

export interface HardwareDiagnostics {
  deviceId: string;
  firmwareVersion: string;
  lanPhyStatus: 'CONNECTED' | 'LINK_DOWN';
  ipAddress: string;
  macAddress: string;
  lastHeartbeat: string;
  latencyMs?: number;
  pins: ParallelPinState;
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
  efficiencyPercentage: number;
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
  shiftKpis: ShiftKpiSummary;
  
  // Real Operational Actions
  assignStopReason: (
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
