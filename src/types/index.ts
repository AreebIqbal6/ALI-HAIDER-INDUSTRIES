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
  data: T;
}

export interface LoomStateData {
  state: LoomStateKind;
  stopCategory: StopCategory | null;
  stopId: string | null;
  since: string;
  rpm: number;
}

export interface StopStartedEventData {
  eventType: 'STOP_STARTED';
  stopId: string;
  stopCategory: StopCategory;
  detectedAt: string;
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
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  ipAddress?: string;
  firmwareVersion?: string;
  uptimeSeconds: number;
  lastError?: string | null;
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
