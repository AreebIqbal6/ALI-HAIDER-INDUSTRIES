// Section 10: Data Contract v1 - Types & Envelopes for WeaveSync SCADA (Ali Haider Industries)

export type SourceKind = 
  | 'LDL' 
  | 'BICOM_ETH' 
  | 'BICOM_OPCUA' 
  | 'BICOM_SERIAL' 
  | 'SENSOR_KIT' 
  | 'GATEWAY' 
  | 'SIM';

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
  BST: 'Beam Stop (Ghaat)',
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
  msgId: string; // UUIDv7, globally unique idempotency key
  seq: number; // Monotonic per (deviceId/adapter, stream)
  machineId: string | null; // e.g. "PIC-427713" (null for gateway health)
  gatewayId: string; // e.g. "AHI-GW-01"
  source: SourceKind;
  deviceId: string | null; // e.g. "LDL-24A1601C3F08" (null for BICOM)
  ts: string; // ISO 8601 UTC with ms (e.g. "2026-11-03T05:15:30.123Z")
  tsQuality: 'SYNCED' | 'ESTIMATED';
  replayed: boolean;
  data: T;
}

// 1. State Payload (`ahi.loom.state/1.0`)
export interface LoomStateData {
  state: LoomStateKind;
  stopCategory: StopCategory | null;
  stopId: string | null; // UUID linking to active stoppage occurrence
  since: string; // ISO 8601 UTC when current state began
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
  failedStartAttempts: number; // runs < 5 picks before stopping again count as failed starts
  resolvedBy?: string;
  operatorReason?: OperatorReasonCode | null;
}

export interface AlarmRaisedEventData {
  eventType: 'ALARM_RAISED';
  alarmCode: string;
  severity: 'WARNING' | 'CRITICAL';
  description: string;
}

export interface CounterDiscontinuityEventData {
  eventType: 'COUNTER_DISCONTINUITY';
  previousPicks: number;
  newPicks: number;
  reason: string;
}

export interface SourceDiscrepancyEventData {
  eventType: 'SOURCE_DISCREPANCY';
  primarySource: SourceKind;
  secondarySource: SourceKind;
  field: string;
  discrepancyDelta: number | string;
}

export type LoomEventData = 
  | StopStartedEventData
  | StopEndedEventData
  | AlarmRaisedEventData
  | CounterDiscontinuityEventData
  | SourceDiscrepancyEventData;

// 3. 1-Minute Counter Rollup (`ahi.loom.counters/1.0`)
export interface LoomCountersData {
  windowStart: string; // ISO 8601 UTC
  windowEnd: string;   // ISO 8601 UTC
  picksDelta: number;
  picksTotal: number;
  runMs: number;
  stopMs: number;
  offlineMs: number;
  stops: {
    WARP: number;
    FILLING: number;
    SELVEDGE: number;
    OTHER: number;
  };
  rpmAvgRunning: number;
}

// 4. Process Diagnostics (`ahi.loom.process/1.0`)
export interface LoomProcessData {
  warpTensionKn: number;
  airPressureBar: number;
  leftRelayBar: number;
  rightRelayBar: number;
  motorLoadPercent: number;
  shedHeightMm?: number;
}

// 5. Device & Gateway Health (`ahi.device.health/1.0`, `ahi.gateway.health/1.0`)
export interface DeviceHealthData {
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  ipAddress?: string;
  rssi?: number;
  firmwareVersion?: string;
  uptimeSeconds: number;
  lastError?: string | null;
}

export interface GatewayHealthData {
  gatewayId: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  connectedDevices: number;
  activeLoomCount: number;
  cpuLoadPercent: number;
  memoryUsedMb: number;
  bufferQueueSize: number;
  uptimeSeconds: number;
}

// 6. Registry Record (`ahi.registry/1.0`)
export interface LoomRegistryRecord {
  machineId: string; // e.g. "PIC-427708"
  loomNumber: number; // 1 to 36+
  family: LoomFamily;
  yearRecorded: string;
  sources: SourceKind[];
  setRpm: number;
  weftDensityPicksPerCm: number; // default 27.2 or 38.2
  ipAddress?: string;
  status: LoomStateKind;
}

// 7. Long Stop Declaration (Supervisor / Operator Action)
export interface LongStopDeclaration {
  stopId: string;
  machineId: string;
  loomNumber: number;
  startedAt: string;
  durationMs: number;
  reasonCode: OperatorReasonCode;
  reasonDescription: string;
  declaredBy: string;
  declaredAt: string;
  notes?: string;
}

// 8. Hardware Node & Optocoupler Pin Diagnostics (XP_CBMP_P9 Tapping)
export interface ParallelPinState {
  piStrt: boolean; // Pin 9: Start / Run status (1 = RUNNING, 0 = STOPPED)
  piPp: boolean;   // Pin 7: Pick pulse counter (rising edge per pick)
  piWd: boolean;   // Pin 8: Warp stop detection (active high opto trigger)
  piFd: boolean;   // Pin 10: Filling / Weft stop detection
  piLd: boolean;   // Pin 6: Leno / Selvedge stop detection
  lastPulseTs: string;
  classificationWindow: {
    windowStartRelMs: number; // -300ms
    windowEndRelMs: number;   // +1000ms
    detectedReason: StopCategory;
    priorityOrder: string[];   // ['FILLING', 'WARP', 'SELVEDGE', 'OTHER']
    confidence: number;       // e.g. 0.99
    isWithinWindow: boolean;
  };
}

export interface HardwareDiagnostics {
  isPilotNode: boolean; // True for Loom 1 (PIC-427708)
  firmwareVersion: string; // e.g. "AHI-WT32-v1.0.4"
  lanPhyStatus: 'CONNECTED_100MBPS' | 'LINK_DOWN';
  ipAddress: string;
  macAddress: string;
  framBuffer: {
    totalBytes: number;
    usedBytes: number;
    wearPct: number;
    recordsBuffered: number;
  };
  outbox: {
    pendingPackets: number;
    droppedPackets: number;
    inflight: boolean;
    lastAckTs: string | null;
    latencyMs: number;
  };
  optocouplerPins: ParallelPinState;
}

// Unified Client Model for UI Components (backed by Canonical Envelopes)
export interface LoomClientState {
  machineId: string;
  loomNumber: number;
  family: LoomFamily;
  sources: SourceKind[];
  setRpm: number;
  weftDensityPicksPerCm: number;
  ipAddress: string;
  isPilotNode?: boolean; // Highlighted badge for WT32-ETH01 hardware node
  
  // Real-time State
  state: LoomStateKind;
  stopCategory: StopCategory | null;
  stopId: string | null;
  since: string;
  rpm: number;
  
  // Shift Counters & Process
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
  cmpx: number; // Stops per 10^5 picks
  
  // Diagnostics
  warpTensionKn: number;
  airPressureBar: number;
  subsystems: {
    sumoMotorStatus: 'HEALTHY' | 'OVERLOAD' | 'OFFLINE';
    fd1Detector: 'OK' | 'FAULT';
    fd2Detector: 'OK' | 'FAULT';
    leftRelayBar: number;
    rightRelayBar: number;
  };
  hardwareDiagnostics?: HardwareDiagnostics;

  // Long Stop Declaration Tracking (> 5 mins)
  isLongStop: boolean;
  longStopDeclared: boolean;
  operatorReasonCode?: OperatorReasonCode | null;
  operatorReasonNote?: string | null;
  declaredBy?: string | null;
  
  lastUpdated: string;
}

// Shift Definition (Section 1 & 11)
export type ShiftType = 'SHIFT_A' | 'SHIFT_B';

export interface ShiftInfo {
  type: ShiftType;
  name: string; // "Shift A (08:00–20:00 PKT)" or "Shift B (20:00–08:00 PKT)"
  startTimeUtc: string;
  endTimeUtc: string;
  elapsedMs: number;
  totalDurationMs: number; // 12 hours = 43,200,000 ms
}

export interface ShiftKpiSummary {
  shift: ShiftInfo;
  averageEfficiency: number;
  averageRpm: number;
  totalPicks: number;
  totalMetresWoven: number;
  activeLoomsCount: number;
  stoppedLoomsCount: number;
  offlineLoomsCount: number;
  totalStops: number;
  cmpxAverage: number; // Stops per 10^5 picks
  mtbfMinutes: number; // Mean Time Between Failures
  mttrMinutes: number; // Mean Time To Repair
  stopsByCategory: {
    WARP: number;
    FILLING: number;
    SELVEDGE: number;
    OTHER: number;
  };
}

export interface AmbientTelemetryState {
  mainAirPressureBar: number;
  hallTemperatureCelsius: number;
  hallHumidityPercentage: number;
  lastUpdated: string;
}

export interface SolarTelemetryState {
  currentGenerationKw: number;
  dailyYieldKwh: number;
  factoryLoadKw: number;
}

export interface TelemetryContextType {
  looms: Record<string, LoomClientState>; // Keyed by machineId (e.g. "PIC-427708")
  selectedMachineId: string | 'GLOBAL';
  setSelectedMachineId: (id: string | 'GLOBAL') => void;
  ambient: AmbientTelemetryState;
  solar: SolarTelemetryState;
  shiftKpis: ShiftKpiSummary;
  gatewayHealth: GatewayHealthData;
  connectionStatus: 'CONNECTED_REALTIME' | 'OFFLINE_MOCK_FALLBACK' | 'CONNECTING';
  mockMode: boolean;
  demoMode: 'CLOUD' | 'LOCAL';
  setDemoMode: (mode: 'CLOUD' | 'LOCAL') => void;
  
  // Actions
  assignLongStopReason: (
    machineId: string, 
    stopId: string, 
    reasonCode: OperatorReasonCode, 
    notes?: string, 
    operatorName?: string
  ) => Promise<boolean>;
  
  addMachine: (
    machineId: string,
    loomNumber: number,
    family: LoomFamily,
    sources: SourceKind[],
    setRpm?: number,
    weftDensity?: number,
    ipAddress?: string
  ) => Promise<string>;
  
  acknowledgeStop: (machineId: string, note?: string) => void;
  dispatchTechnician: (machineId: string, technicianName: string) => void;

  // Pilot Demo Secret Weapon Controls
  triggerSimulatedStop: (machineId: string, category: 'WARP' | 'FILLING' | 'SELVEDGE' | 'LONG_STOP') => Promise<void>;
  clearSimulatedStop: (machineId: string) => Promise<void>;
}
