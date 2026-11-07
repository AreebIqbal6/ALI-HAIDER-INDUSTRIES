import { 
  updateLoomCache, 
  updateAmbientCache, 
  updateSolarCache, 
  LoomDeviceState, 
  CanonicalEnvelope,
  LoomFamily, 
  SourceKind, 
  StopCategory,
  LoomStateKind
} from './index';

export function generateUuidV7(): string {
  const now = Date.now();
  const timeHex = now.toString(16).padStart(12, '0');
  const randHex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-7${randHex().slice(1)}-8${randHex().slice(1)}-${randHex()}${randHex()}${randHex()}`;
}

export interface RealLoomDefinition {
  loomNumber: number;
  machineId: string;
  family: LoomFamily;
  yearRecorded: string;
  sources: SourceKind[];
  setRpm: number;
  weftDensity: number;
  ipAddress: string;
}

// 36 Official Machines registered at Ali Haider Industries (Section 10.1)
// Loom 1 is the Pilot Hardware Node (WT32-ETH01 + PC817 tapping XP_CBMP_P9)
export const OFFICIAL_FLEET_36: RealLoomDefinition[] = [
  // 25x OmniPlus-i (07–08/2021): PIC-427708 to PIC-427732 -> Looms 1 to 25 (Loom 1 = PILOT NODE)
  { loomNumber: 1,  machineId: 'PIC-427708', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.101' },
  { loomNumber: 2,  machineId: 'PIC-427709', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.102' },
  { loomNumber: 3,  machineId: 'PIC-427710', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.103' },
  { loomNumber: 4,  machineId: 'PIC-427711', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.104' },
  { loomNumber: 5,  machineId: 'PIC-427712', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.105' },
  { loomNumber: 6,  machineId: 'PIC-427713', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.106' },
  { loomNumber: 7,  machineId: 'PIC-427714', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.107' },
  { loomNumber: 8,  machineId: 'PIC-427715', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.108' },
  { loomNumber: 9,  machineId: 'PIC-427716', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.109' },
  { loomNumber: 10, machineId: 'PIC-427717', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.110' },
  { loomNumber: 11, machineId: 'PIC-427718', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.111' },
  { loomNumber: 12, machineId: 'PIC-427719', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.112' },
  { loomNumber: 13, machineId: 'PIC-427720', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.113' },
  { loomNumber: 14, machineId: 'PIC-427721', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.114' },
  { loomNumber: 15, machineId: 'PIC-427722', family: 'OmniPlus-i', yearRecorded: '07/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.115' },
  { loomNumber: 16, machineId: 'PIC-427723', family: 'OmniPlus-i', yearRecorded: '08/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.116' },
  { loomNumber: 17, machineId: 'PIC-427724', family: 'OmniPlus-i', yearRecorded: '08/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.117' },
  { loomNumber: 18, machineId: 'PIC-427725', family: 'OmniPlus-i', yearRecorded: '08/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.118' },
  { loomNumber: 19, machineId: 'PIC-427726', family: 'OmniPlus-i', yearRecorded: '08/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.119' },
  { loomNumber: 20, machineId: 'PIC-427727', family: 'OmniPlus-i', yearRecorded: '08/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.120' },
  { loomNumber: 21, machineId: 'PIC-427728', family: 'OmniPlus-i', yearRecorded: '08/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.121' },
  { loomNumber: 22, machineId: 'PIC-427729', family: 'OmniPlus-i', yearRecorded: '08/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.122' },
  { loomNumber: 23, machineId: 'PIC-427730', family: 'OmniPlus-i', yearRecorded: '08/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.123' },
  { loomNumber: 24, machineId: 'PIC-427731', family: 'OmniPlus-i', yearRecorded: '08/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.124' },
  { loomNumber: 25, machineId: 'PIC-427732', family: 'OmniPlus-i', yearRecorded: '08/2021', sources: ['LDL', 'BICOM_ETH'], setRpm: 874, weftDensity: 27.2, ipAddress: '192.168.10.125' },

  // 9x OmniPlus 800 (09/2005–02/2006): Looms 26 to 34
  { loomNumber: 26, machineId: 'PIC-279327', family: 'OmniPlus 800', yearRecorded: '09/2005', sources: ['LDL'], setRpm: 501, weftDensity: 38.2, ipAddress: '192.168.20.126' },
  { loomNumber: 27, machineId: 'PIC-278863', family: 'OmniPlus 800', yearRecorded: '09/2005', sources: ['LDL'], setRpm: 501, weftDensity: 38.2, ipAddress: '192.168.20.127' },
  { loomNumber: 28, machineId: 'PIC-279323', family: 'OmniPlus 800', yearRecorded: '09/2005', sources: ['LDL'], setRpm: 501, weftDensity: 38.2, ipAddress: '192.168.20.128' },
  { loomNumber: 29, machineId: 'PIC-279105', family: 'OmniPlus 800', yearRecorded: '09/2005', sources: ['LDL'], setRpm: 501, weftDensity: 38.2, ipAddress: '192.168.20.129' },
  { loomNumber: 30, machineId: 'PIC-279099', family: 'OmniPlus 800', yearRecorded: '09/2005', sources: ['LDL'], setRpm: 501, weftDensity: 38.2, ipAddress: '192.168.20.130' },
  { loomNumber: 31, machineId: 'PIC-281560', family: 'OmniPlus 800', yearRecorded: '02/2006', sources: ['LDL'], setRpm: 501, weftDensity: 38.2, ipAddress: '192.168.20.131' },
  { loomNumber: 32, machineId: 'PIC-281554', family: 'OmniPlus 800', yearRecorded: '02/2006', sources: ['LDL'], setRpm: 501, weftDensity: 38.2, ipAddress: '192.168.20.132' },
  { loomNumber: 33, machineId: 'PIC-281553', family: 'OmniPlus 800', yearRecorded: '02/2006', sources: ['LDL'], setRpm: 501, weftDensity: 38.2, ipAddress: '192.168.20.133' },
  { loomNumber: 34, machineId: 'PIC-281481', family: 'OmniPlus 800', yearRecorded: '02/2006', sources: ['LDL'], setRpm: 501, weftDensity: 38.2, ipAddress: '192.168.20.134' },

  // 2x OmniPlus Summum (11/2012 & 05/2015): Looms 35 to 36
  { loomNumber: 35, machineId: 'PIC-332235', family: 'OmniPlus Summum', yearRecorded: '11/2012', sources: ['LDL', 'BICOM_ETH'], setRpm: 850, weftDensity: 27.2, ipAddress: '192.168.10.135' },
  { loomNumber: 36, machineId: 'PIC-315816', family: 'OmniPlus Summum', yearRecorded: '05/2015', sources: ['LDL', 'BICOM_ETH'], setRpm: 850, weftDensity: 27.2, ipAddress: '192.168.10.136' },
];

export const mockLoomDevices: Map<string, LoomDeviceState> = new Map();

// Helper to construct baseline device state
export function createLoomDeviceState(def: RealLoomDefinition): LoomDeviceState {
  const isRunning = Math.random() > 0.12;
  const state: LoomStateKind = isRunning ? 'RUNNING' : 'STOPPED';
  const stopCategory: StopCategory | null = isRunning ? null : (['WARP', 'FILLING', 'SELVEDGE', 'OTHER'][Math.floor(Math.random() * 4)] as StopCategory);
  const stopId = isRunning ? null : generateUuidV7();
  const currentRpm = isRunning ? (def.setRpm + Math.floor(Math.random() * 9) - 4) : 0;

  return {
    machineId: def.machineId,
    loomNumber: def.loomNumber,
    family: def.family,
    sources: def.sources,
    setRpm: def.setRpm,
    weftDensityPicksPerCm: def.weftDensity,
    ipAddress: def.ipAddress,
    state,
    stopCategory,
    stopId,
    since: new Date(Date.now() - (isRunning ? 1800000 : 180000)).toISOString(),
    rpm: currentRpm,
    totalPicks: 1540000 + (def.loomNumber * 21500),
    minutePicksAccumulator: 0,
    minuteRunMs: 0,
    minuteStopMs: 0,
    minuteStops: { WARP: 0, FILLING: 0, SELVEDGE: 0, OTHER: 0 },
    warpTensionKn: Number((1.90 + (Math.random() * 0.2 - 0.1)).toFixed(2)),
    airPressureBar: Number((7.35 + (Math.random() * 0.2 - 0.1)).toFixed(2)),
    lastSeq: 1000 + def.loomNumber
  };
}

// Initialize all 36 looms
OFFICIAL_FLEET_36.forEach(def => {
  mockLoomDevices.set(def.machineId, createLoomDeviceState(def));
});

// Support dynamic provisioning of new looms (e.g. Looms 37, 38, 39)
export function addMockLoom(def: RealLoomDefinition): LoomDeviceState {
  const newState = createLoomDeviceState(def);
  mockLoomDevices.set(def.machineId, newState);
  updateLoomCache(newState);
  return newState;
}

export const liveHardwareLooms: Set<string> = new Set();
let currentGatewayMode: 'SIM' | 'HYBRID' | 'LIVE' = 'HYBRID';

export function setGatewayMode(mode: 'SIM' | 'HYBRID' | 'LIVE') {
  currentGatewayMode = mode;
}

// Mutate state every second
function mutateDevice(dev: LoomDeviceState): CanonicalEnvelope<any>[] {
  // If the machine is streaming live hardware data (e.g. WT32-ETH01 on Loom 1 PIC-427708),
  // automatically suppress simulated loop in HYBRID or LIVE mode
  if (currentGatewayMode !== 'SIM' && liveHardwareLooms.has(dev.machineId)) {
    return [];
  }

  const envelopes: CanonicalEnvelope<any>[] = [];
  const now = new Date().toISOString();
  dev.lastSeq++;

  // 1. Stochastic Stop / Start Events
  if (dev.state === 'RUNNING') {
    dev.minuteRunMs += 1000;
    const picksThisSec = Math.floor(dev.rpm / 60);
    dev.minutePicksAccumulator += picksThisSec;
    dev.totalPicks += picksThisSec;

    // Small jitter in speed around setRpm
    const jitter = Math.floor(Math.random() * 5) - 2;
    dev.rpm = Math.max(0, dev.setRpm + jitter);

    // 0.3% chance to encounter stoppage
    if (Math.random() < 0.003) {
      dev.state = 'STOPPED';
      const categories: StopCategory[] = ['WARP', 'WARP', 'FILLING', 'SELVEDGE', 'OTHER'];
      dev.stopCategory = categories[Math.floor(Math.random() * categories.length)] || 'WARP';
      dev.stopId = generateUuidV7();
      dev.since = now;
      dev.rpm = 0;
      dev.minuteStops[dev.stopCategory]++;

      // Emit STOP_STARTED event envelope
      envelopes.push({
        schema: 'ahi.loom.event/1.0',
        msgId: generateUuidV7(),
        seq: dev.lastSeq,
        machineId: dev.machineId,
        gatewayId: 'AHI-GW-01',
        source: dev.sources[0] || 'LDL',
        deviceId: `LDL-${dev.machineId.replace('PIC-', '')}`,
        ts: now,
        tsQuality: 'SYNCED',
        replayed: false,
        data: {
          eventType: 'STOP_STARTED',
          stopId: dev.stopId,
          stopCategory: dev.stopCategory,
          rpmAtStop: dev.setRpm,
          picksAtStop: dev.totalPicks
        }
      });

      // Emit State change envelope
      envelopes.push({
        schema: 'ahi.loom.state/1.0',
        msgId: generateUuidV7(),
        seq: ++dev.lastSeq,
        machineId: dev.machineId,
        gatewayId: 'AHI-GW-01',
        source: dev.sources[0] || 'LDL',
        deviceId: `LDL-${dev.machineId.replace('PIC-', '')}`,
        ts: now,
        tsQuality: 'SYNCED',
        replayed: false,
        data: {
          state: 'STOPPED',
          stopCategory: dev.stopCategory,
          stopId: dev.stopId,
          since: dev.since,
          rpm: 0
        }
      });
    }
  } else if (dev.state === 'STOPPED') {
    dev.minuteStopMs += 1000;
    dev.rpm = 0;

    // 2% chance to be fixed by operator / weaver and resume
    if (Math.random() < 0.02) {
      const stopDurationMs = Date.now() - new Date(dev.since).getTime();
      const stoppedCategory = dev.stopCategory || 'WARP';
      const closedStopId = dev.stopId || generateUuidV7();

      dev.state = 'RUNNING';
      dev.stopCategory = null;
      dev.stopId = null;
      dev.since = now;
      dev.rpm = dev.setRpm;

      // Emit STOP_ENDED event envelope
      envelopes.push({
        schema: 'ahi.loom.event/1.0',
        msgId: generateUuidV7(),
        seq: dev.lastSeq,
        machineId: dev.machineId,
        gatewayId: 'AHI-GW-01',
        source: dev.sources[0] || 'LDL',
        deviceId: `LDL-${dev.machineId.replace('PIC-', '')}`,
        ts: now,
        tsQuality: 'SYNCED',
        replayed: false,
        data: {
          eventType: 'STOP_ENDED',
          stopId: closedStopId,
          stopCategory: stoppedCategory,
          durationMs: stopDurationMs,
          failedStartAttempts: 0,
          resolvedBy: 'Floor Weaver'
        }
      });

      // Emit State change envelope
      envelopes.push({
        schema: 'ahi.loom.state/1.0',
        msgId: generateUuidV7(),
        seq: ++dev.lastSeq,
        machineId: dev.machineId,
        gatewayId: 'AHI-GW-01',
        source: dev.sources[0] || 'LDL',
        deviceId: `LDL-${dev.machineId.replace('PIC-', '')}`,
        ts: now,
        tsQuality: 'SYNCED',
        replayed: false,
        data: {
          state: 'RUNNING',
          stopCategory: null,
          stopId: null,
          since: dev.since,
          rpm: dev.rpm
        }
      });
    }
  }

  return envelopes;
}

// Roll up 1-minute counters
export function generateMinuteCounter(dev: LoomDeviceState): CanonicalEnvelope<any> {
  const windowEnd = new Date().toISOString();
  const windowStart = new Date(Date.now() - 60000).toISOString();
  const runMs = dev.minuteRunMs;
  const stopMs = dev.minuteStopMs;
  const picks = dev.minutePicksAccumulator;
  const rpmAvg = runMs > 0 ? Number(((picks / (runMs / 60000.0))).toFixed(1)) : 0;

  const counterPayload = {
    schema: 'ahi.loom.counters/1.0' as const,
    msgId: generateUuidV7(),
    seq: ++dev.lastSeq,
    machineId: dev.machineId,
    gatewayId: 'AHI-GW-01',
    source: dev.sources[0] || 'LDL',
    deviceId: `LDL-${dev.machineId.replace('PIC-', '')}`,
    ts: windowEnd,
    tsQuality: 'SYNCED' as const,
    replayed: false,
    data: {
      windowStart,
      windowEnd,
      picksDelta: picks,
      picksTotal: dev.totalPicks,
      runMs,
      stopMs,
      offlineMs: 0,
      stops: { ...dev.minuteStops },
      rpmAvgRunning: rpmAvg
    }
  };

  // Reset minute accumulators
  dev.minutePicksAccumulator = 0;
  dev.minuteRunMs = 0;
  dev.minuteStopMs = 0;
  dev.minuteStops = { WARP: 0, FILLING: 0, SELVEDGE: 0, OTHER: 0 };

  return counterPayload;
}

export function startDeviceDrivers() {
  console.log('⚡ Starting high-speed device simulation for 36 Picanol Looms...');

  let tick = 0;
  setInterval(() => {
    tick++;
    mockLoomDevices.forEach((dev) => {
      mutateDevice(dev);
      updateLoomCache({ ...dev });
    });

    // Ambient update
    updateAmbientCache({
      main_air_pressure_bar: Number((7.35 + (Math.random() * 0.2 - 0.1)).toFixed(2)),
      hall_temperature_celsius: 27.8,
      hall_humidity_percentage: 68.2
    });

    // Solar update
    const hour = new Date().getHours();
    const solarKw = (hour >= 6 && hour <= 18) ? 180 + Math.random() * 30 : 0;
    updateSolarCache({
      current_generation_kw: Number(solarKw.toFixed(1)),
      daily_yield_kwh: 1250,
      factory_load_kw: 315
    });

  }, 1000);
}
