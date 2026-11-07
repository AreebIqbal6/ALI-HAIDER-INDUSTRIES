import http from 'http';
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

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export type GatewayMode = 'SIM' | 'HYBRID' | 'LIVE';
export const GATEWAY_MODE: GatewayMode = (process.env.GATEWAY_MODE as GatewayMode) || 'HYBRID';
export const PILOT_LOOM_ID = process.env.PILOT_LOOM_ID || 'PIC-427708';
const HTTP_PORT = Number(process.env.EDGE_GATEWAY_HTTP_PORT || 4841);

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

// -------------------------------------------------------------
// Direct HTTP Bridge for WT32-ETH01 hardware node
// Allows ESP32 to POST raw pin pulses or JSON envelopes over LAN
// -------------------------------------------------------------
function startHttpBridge() {
  const server = http.createServer((req, res) => {
    // CORS headers for local LAN clients
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ONLINE',
        mode: GATEWAY_MODE,
        pilotLoom: PILOT_LOOM_ID,
        liveLooms: Array.from(liveHardwareLooms),
        cachedLooms: telemetryCache.looms.size
      }));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const machineId = payload.machineId || PILOT_LOOM_ID;

          // Register machine as active live hardware node
          liveHardwareLooms.add(machineId);
          console.log(`📡 [HARDWARE INGEST] Live packet received for ${machineId} (Mode: ${GATEWAY_MODE})`);

          const existingDev = mockLoomDevices.get(machineId);
          if (existingDev) {
            existingDev.isLiveHardware = true;
            if (payload.pins) {
              const isRunning = Boolean(payload.pins.piStrt === 1 || payload.pins.piStrt === true);
              existingDev.state = isRunning ? 'RUNNING' : 'STOPPED';
              if (!isRunning) {
                if (payload.pins.piFd) existingDev.stopCategory = 'FILLING';
                else if (payload.pins.piWd) existingDev.stopCategory = 'WARP';
                else if (payload.pins.piLd) existingDev.stopCategory = 'SELVEDGE';
                else existingDev.stopCategory = 'OTHER';
                existingDev.rpm = 0;
              } else {
                existingDev.stopCategory = null;
                existingDev.rpm = payload.rpm || existingDev.setRpm;
              }
              if (payload.picksDelta) {
                existingDev.minutePicksAccumulator += Number(payload.picksDelta);
                existingDev.totalPicks += Number(payload.picksDelta);
              }
            } else if (payload.state) {
              existingDev.state = payload.state;
              existingDev.stopCategory = payload.stopCategory || null;
              existingDev.rpm = payload.rpm ?? (payload.state === 'RUNNING' ? existingDev.setRpm : 0);
            }
            updateLoomCache({ ...existingDev });
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, machineId, mode: GATEWAY_MODE }));
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log(`🔌 WT32-ETH01 LAN Bridge listening on http://0.0.0.0:${HTTP_PORT} (Mode: ${GATEWAY_MODE})`);
  });
}

async function dispatchLoop() {
  let tick = 0;
  setInterval(async () => {
    tick++;
    const now = new Date().toISOString();

    // Determine looms to dispatch according to GATEWAY_MODE
    const allCached = Array.from(telemetryCache.looms.values());
    let activeLoomsToDispatch: LoomDeviceState[] = [];

    if (GATEWAY_MODE === 'SIM') {
      activeLoomsToDispatch = allCached;
    } else if (GATEWAY_MODE === 'HYBRID') {
      // In HYBRID: dispatch all 36 (live hardware loom + 35 simulated looms)
      activeLoomsToDispatch = allCached;
    } else if (GATEWAY_MODE === 'LIVE') {
      // In LIVE: only dispatch real hardware nodes
      activeLoomsToDispatch = allCached.filter(dev => liveHardwareLooms.has(dev.machineId));
    }

    if (!supabase) {
      if (tick % 5 === 0) {
        console.log(`[DRY RUN] ${now} [Mode: ${GATEWAY_MODE}] Aggregated ${activeLoomsToDispatch.length} machines. Live Hardware: [${Array.from(liveHardwareLooms).join(', ')}]`);
      }
      return;
    }

    try {
      // 1. Dispatch State Updates every 1 second
      const stateUpdates = activeLoomsToDispatch.map(dev => ({
        machine_id: dev.machineId,
        state: dev.state,
        stop_category: dev.stopCategory,
        stop_id: dev.stopId,
        since: dev.since,
        rpm: dev.rpm,
        warp_tension_kn: dev.warpTensionKn,
        air_pressure_bar: dev.airPressureBar,
        last_ts: now,
        replayed: false,
        updated_at: now
      }));

      if (stateUpdates.length > 0) {
        await supabase.from('loom_live_state').upsert(stateUpdates, { onConflict: 'machine_id' });
      }

      // 2. Dispatch 1-Minute Counters every 60 seconds
      if (tick % 60 === 0) {
        const counterEnvelopes = activeLoomsToDispatch.map(dev => generateMinuteCounter(dev));
        const counterRows = counterEnvelopes.map(e => ({
          machine_id: e.machineId,
          window_start: e.data.windowStart,
          window_end: e.data.windowEnd,
          picks_delta: e.data.picksDelta,
          picks_total: e.data.picksTotal,
          run_ms: e.data.runMs,
          stop_ms: e.data.stopMs,
          offline_ms: e.data.offlineMs,
          stops_warp: e.data.stops.WARP,
          stops_filling: e.data.stops.FILLING,
          stops_selvedge: e.data.stops.SELVEDGE,
          stops_other: e.data.stops.OTHER,
          rpm_avg_running: e.data.rpmAvgRunning,
          source: e.source,
          created_at: now
        }));

        await supabase.from('loom_minute_counters').upsert(counterRows, { onConflict: 'machine_id, window_start' });
        console.log(`[COUNTERS] Rolled up 1-minute counters for ${counterRows.length} looms.`);
      }

      // 3. Dispatch Ambient and Solar
      if (telemetryCache.ambient) {
        await supabase.from('factory_ambient_telemetry').insert({
          main_air_pressure_bar: telemetryCache.ambient.main_air_pressure_bar,
          hall_temperature_celsius: telemetryCache.ambient.hall_temperature_celsius,
          hall_humidity_percentage: telemetryCache.ambient.hall_humidity_percentage,
          recorded_at: now
        });
      }

      if (telemetryCache.solar) {
        await supabase.from('solar_live_telemetry').insert({
          current_generation_kw: telemetryCache.solar.current_generation_kw,
          daily_yield_kwh: telemetryCache.solar.daily_yield_kwh,
          recorded_at: now
        });
      }

      // 4. Gateway Heartbeat (Liveness > 90s)
      if (tick % 15 === 0) {
        await supabase.from('gateway_health').upsert({
          gateway_id: 'AHI-GW-01',
          last_seen_at: now,
          status: 'ONLINE',
          connected_devices: activeLoomsToDispatch.length,
          metadata: {
            uptimeSeconds: tick,
            mode: GATEWAY_MODE,
            activeLooms: activeLoomsToDispatch.filter(l => l.state === 'RUNNING').length,
            liveHardwareLooms: Array.from(liveHardwareLooms)
          }
        }, { onConflict: 'gateway_id' });
      }

      if (tick % 10 === 0) {
        console.log(`[DISPATCH] Mode: ${GATEWAY_MODE} | Live states updated for ${stateUpdates.length} looms (${liveHardwareLooms.size} hardware live).`);
      }

    } catch (err: any) {
      console.error('Fatal dispatch error in edge gateway:', err.message);
    }
  }, 1000);
}

async function main() {
  console.log(`🚀 Starting WeaveSync SCADA Edge Gateway (Ali Haider Industries - Data Contract v1)...`);
  console.log(`⚙️ GATEWAY_MODE: ${GATEWAY_MODE} | PILOT_LOOM_ID: ${PILOT_LOOM_ID}`);
  startDeviceDrivers();
  startHttpBridge();
  dispatchLoop();
}

if (require.main === module) {
  main().catch(console.error);
}
