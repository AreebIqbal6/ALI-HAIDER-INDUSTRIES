import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { 
  startDeviceDrivers, 
  mockLoomDevices, 
  generateMinuteCounter, 
  generateUuidV7,
  OFFICIAL_FLEET_36,
  liveHardwareLooms,
  setGatewayMode
} from './mock-devices';
import { outbox } from './outbox';
import { TelemetryCollector } from './collector';
import { forwarder } from './forwarder';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export type GatewayMode = 'SIM' | 'HYBRID' | 'LIVE';
export const GATEWAY_MODE: GatewayMode = (process.env.GATEWAY_MODE as GatewayMode) || 'HYBRID';
export const PILOT_LOOM_ID = process.env.PILOT_LOOM_ID || 'PIC-427708';
export const HTTP_PORT = Number(process.env.EDGE_GATEWAY_HTTP_PORT || 4841);

setGatewayMode(GATEWAY_MODE);

export type SourceKind = 'LDL' | 'BICOM_ETH' | 'BICOM_OPCUA' | 'BICOM_SERIAL' | 'SENSOR_KIT' | 'GATEWAY' | 'SIM';
export type StopCategory = 'WARP' | 'FILLING' | 'SELVEDGE' | 'OTHER';
export type LoomStateKind = 'RUNNING' | 'STOPPED' | 'OFFLINE' | 'UNKNOWN';
export type LoomFamily = 'OmniPlus-i' | 'OmniPlus Summum' | 'OmniPlus 800';

export interface LoomStateData {
  state: LoomStateKind;
  stopCategory: StopCategory | null;
  stopId: string | null;
  since: string;
  rpm: number;
}

export interface LoomCountersData {
  windowStart: string;
  windowEnd: string;
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

export interface CanonicalEnvelope<T = unknown> {
  schema: string;
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

export interface LoomDeviceState {
  machineId: string;
  loomNumber: number;
  family: LoomFamily;
  sources: SourceKind[];
  setRpm: number;
  weftDensityPicksPerCm: number;
  ipAddress: string;
  state: LoomStateKind;
  stopCategory: StopCategory | null;
  stopId: string | null;
  since: string;
  rpm: number;
  totalPicks: number;
  minutePicksAccumulator: number;
  minuteRunMs: number;
  minuteStopMs: number;
  minuteStops: {
    WARP: number;
    FILLING: number;
    SELVEDGE: number;
    OTHER: number;
  };
  warpTensionKn: number;
  airPressureBar: number;
  lastSeq: number;
  isLiveHardware?: boolean;
}

export interface AmbientState {
  main_air_pressure_bar: number;
  hall_temperature_celsius: number;
  hall_humidity_percentage: number;
}

export interface SolarState {
  current_generation_kw: number;
  daily_yield_kwh: number;
  factory_load_kw: number;
}

const telemetryCache = {
  looms: new Map<string, LoomDeviceState>(),
  ambient: null as AmbientState | null,
  solar: null as SolarState | null,
};

export function updateLoomCache(data: LoomDeviceState) {
  telemetryCache.looms.set(data.machineId, data);
}

export function updateAmbientCache(data: AmbientState) {
  telemetryCache.ambient = data;
}

export function updateSolarCache(data: SolarState) {
  telemetryCache.solar = data;
}

let collector: TelemetryCollector | null = null;

async function startHeartbeatLoop() {
  let tick = 0;
  setInterval(async () => {
    tick++;
    const now = new Date().toISOString();
    const allCached = Array.from(telemetryCache.looms.values());
    const runningCount = allCached.filter(l => l.state === 'RUNNING').length;
    const stats = outbox.getStats();

    if (tick % 15 === 0) {
      if (supabase) {
        try {
          await supabase.from('gateway_health').upsert({
            gateway_id: 'AHI-GW-01',
            last_seen_at: now,
            status: 'ONLINE',
            connected_devices: allCached.length,
            metadata: {
              uptimeSeconds: tick,
              mode: GATEWAY_MODE,
              activeLooms: runningCount,
              liveHardwareLooms: Array.from(liveHardwareLooms),
              outboxPending: stats.pendingCount
            }
          }, { onConflict: 'gateway_id' });
        } catch {
          // Handled gracefully
        }
      }

      console.log(`💓 [HEARTBEAT] Gateway AHI-GW-01 | Mode: ${GATEWAY_MODE} | Looms: ${allCached.length} (${runningCount} RUNNING) | Outbox Pending: ${stats.pendingCount}`);
    }
  }, 1000);
}

async function main() {
  console.log(`================================================================`);
  console.log(`  WEAVESYNC SCADA EDGE GATEWAY (ALI HAIDER INDUSTRIES - v1.0)   `);
  console.log(`  Mode: ${GATEWAY_MODE} | Pilot Node: ${PILOT_LOOM_ID} | Port: ${HTTP_PORT}`);
  console.log(`================================================================`);

  // 1. Initialise SQLite WAL Outbox Service
  outbox.init(process.env.SQLITE_DB_PATH);

  // 2. Start Hardware / Simulated Device Drivers
  startDeviceDrivers();

  // 3. Start Telemetry Collector (HTTP & Device Ingest)
  collector = new TelemetryCollector({
    httpPort: HTTP_PORT,
    mode: GATEWAY_MODE,
    pilotLoomId: PILOT_LOOM_ID
  });
  collector.start();

  // 4. Start Telemetry Forwarder (Outbox -> Cloud / Database)
  forwarder.start(1000);

  // 5. Start Gateway Health & Heartbeat Loop
  startHeartbeatLoop();
}

// Graceful process termination handling
const handleShutdown = (signal: string) => {
  console.log(`\n🛑 Received ${signal}. Shutting down edge gateway cleanly...`);
  if (collector) collector.stop();
  forwarder.stop();
  outbox.close();
  process.exit(0);
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal crash in Edge Gateway:', err);
    process.exit(1);
  });
}
