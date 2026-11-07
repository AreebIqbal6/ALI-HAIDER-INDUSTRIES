import http from 'http';
import { outbox } from './outbox';
import { 
  mockLoomDevices, 
  generateMinuteCounter, 
  liveHardwareLooms
} from './mock-devices';
import { GATEWAY_MODE, PILOT_LOOM_ID, LoomDeviceState, updateLoomCache } from './index';

export interface CollectorConfig {
  httpPort: number;
  mode: 'SIM' | 'HYBRID' | 'LIVE';
  pilotLoomId: string;
}

export class TelemetryCollector {
  private server: http.Server | null = null;
  private config: CollectorConfig;
  private simTimer: NodeJS.Timeout | null = null;
  private tickCount: number = 0;

  constructor(config: CollectorConfig) {
    this.config = config;
  }

  public start(): void {
    this.startHttpServer();
    this.startSimulationLoop();
    console.log(`📥 [COLLECTOR] Telemetry collector active on HTTP Port ${this.config.httpPort} (Mode: ${this.config.mode})`);
  }

  private startHttpServer(): void {
    this.server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === 'GET' && req.url === '/health') {
        const stats = outbox.getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ONLINE',
          mode: this.config.mode,
          pilotLoom: this.config.pilotLoomId,
          liveHardwareNodes: Array.from(liveHardwareLooms),
          outbox: stats
        }));
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}');
            const machineId = payload.machineId || this.config.pilotLoomId;

            // Mark machine as live hardware
            liveHardwareLooms.add(machineId);

            const dev = mockLoomDevices.get(machineId);
            if (dev) {
              dev.isLiveHardware = true;
              if (payload.pins) {
                const isRunning = Boolean(payload.pins.piStrt === 1 || payload.pins.piStrt === true);
                dev.state = isRunning ? 'RUNNING' : 'STOPPED';
                if (!isRunning) {
                  if (payload.pins.piFd) dev.stopCategory = 'FILLING';
                  else if (payload.pins.piWd) dev.stopCategory = 'WARP';
                  else if (payload.pins.piLd) dev.stopCategory = 'SELVEDGE';
                  else dev.stopCategory = 'OTHER';
                  dev.rpm = 0;
                } else {
                  dev.stopCategory = null;
                  dev.rpm = payload.rpm || dev.setRpm;
                }
                if (payload.picksDelta) {
                  dev.minutePicksAccumulator += Number(payload.picksDelta);
                  dev.totalPicks += Number(payload.picksDelta);
                }
              } else if (payload.state) {
                dev.state = payload.state;
                dev.stopCategory = payload.stopCategory || null;
                dev.rpm = payload.rpm ?? (payload.state === 'RUNNING' ? dev.setRpm : 0);
              }
              updateLoomCache({ ...dev });
            }

            // Enqueue into SQLite WAL Outbox
            const now = new Date().toISOString();
            if (payload.schema) {
              outbox.enqueue(payload);
            } else {
              // Wrap raw pin payload into canonical envelope
              outbox.enqueue({
                schema: 'ahi.loom.state/1.0',
                msgId: `${machineId}-hw-${Date.now()}`,
                machineId,
                gatewayId: 'AHI-GW-01',
                source: 'SENSOR_KIT',
                deviceId: 'WT32-ETH01-PILOT',
                ts: now,
                tsQuality: 'SYNCED',
                replayed: false,
                data: {
                  state: dev ? dev.state : (payload.state || 'RUNNING'),
                  stopCategory: dev ? dev.stopCategory : (payload.stopCategory || null),
                  stopId: null,
                  since: now,
                  rpm: dev ? dev.rpm : (payload.rpm || 874)
                }
              });
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, machineId, mode: this.config.mode }));
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

    this.server.listen(this.config.httpPort, '0.0.0.0', () => {
      console.log(`🔌 [COLLECTOR] Direct LAN Bridge listening at http://0.0.0.0:${this.config.httpPort}`);
    });
  }

  private startSimulationLoop(): void {
    // Generates simulated envelopes for non-hardware looms
    this.simTimer = setInterval(() => {
      this.tickCount++;
      const now = new Date().toISOString();

      for (const [id, dev] of mockLoomDevices.entries()) {
        // Skip hardware machines in HYBRID or LIVE mode
        if (this.config.mode === 'LIVE' && !liveHardwareLooms.has(id)) continue;
        if (this.config.mode === 'HYBRID' && liveHardwareLooms.has(id)) continue;

        // 1. Emit State Envelope every 1 sec
        outbox.enqueue({
          schema: 'ahi.loom.state/1.0',
          msgId: `${id}-state-${Date.now()}`,
          machineId: id,
          gatewayId: 'AHI-GW-01',
          source: dev.sources[0] || 'SIM',
          deviceId: `SIM-${id}`,
          ts: now,
          tsQuality: 'SYNCED',
          replayed: false,
          data: {
            state: dev.state,
            stopCategory: dev.stopCategory,
            stopId: dev.stopId,
            since: dev.since,
            rpm: dev.rpm
          }
        });

        // 2. Emit Minute Counter every 60 sec
        if (this.tickCount % 60 === 0) {
          const counterEnv = generateMinuteCounter(dev);
          outbox.enqueue(counterEnv);
        }
      }
    }, 1000);
  }

  public stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (this.simTimer) {
      clearInterval(this.simTimer);
      this.simTimer = null;
    }
  }
}
