#!/usr/bin/env node
/**
 * Contract v1 HTTP simulator: posts valid batches for one or more simulated looms.
 *
 * Single loom:
 *   node scripts/sim-http.mjs --url http://localhost:3000 --device e0e2e6aabbcc --machine PIC-427708 --token <token>
 * Several looms (each logger has its own token), JSON file: [{"deviceId","machineId","token"}, ...]
 *   node scripts/sim-http.mjs --url https://<app>.vercel.app --looms looms.json
 *
 * Options:
 *   --interval <ms>   tick interval (default 5000); a state heartbeat is sent every tick
 *   --ticks <n>       stop after n ticks (default: run until Ctrl+C)
 *   --dup             re-send every batch once more and check the results are all 'duplicate'
 *   --replay          first send a backlog of 10 replayed=true, ESTIMATED older messages
 *   --skew            send timestamps 10 min in the future (server must mark them ESTIMATED)
 * The token may also be given as SIM_DEVICE_TOKEN in the environment.
 */
import fs from 'fs';
import { generateUuidV7 } from './lib/uuidv7.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args.url || 'http://localhost:3000').replace(/\/$/, '');
const endpoint = `${baseUrl}/api/ingest/v1/batch`;
const intervalMs = Number(args.interval || 5000);
const maxTicks = args.ticks ? Number(args.ticks) : Infinity;
const skewMs = args.skew ? 10 * 60 * 1000 : 0;

let looms;
if (args.looms) {
  looms = JSON.parse(fs.readFileSync(String(args.looms), 'utf8'));
} else {
  looms = [{
    deviceId: args.device,
    machineId: args.machine,
    token: args.token || process.env.SIM_DEVICE_TOKEN,
  }];
}
for (const l of looms) {
  if (!l.deviceId || !/^PIC-[A-Za-z0-9]+$/.test(l.machineId || '') || !l.token) {
    console.error('Each loom needs deviceId, machineId (PIC-<serial>) and token. See header of this file.');
    process.exit(1);
  }
}

const CATS = ['WARP', 'FILLING', 'SELVEDGE', 'OTHER'];
const iso = (ms) => new Date(ms + skewMs).toISOString();

function makeSim(cfg) {
  const now = Date.now();
  return {
    ...cfg,
    bootId: Math.floor(now / 1000) % 100000,
    seq: 0,
    state: 'RUNNING',
    stopCategory: null,
    stopId: null,
    since: now,
    rpm: 860 + Math.random() * 30,
    picksTotal: Math.floor(1_000_000 + Math.random() * 500_000),
    failedStarts: 0,
    lastTick: now,
    window: { start: Math.floor(now / 60000) * 60000, picks: 0, runMs: 0, stopMs: 0, stops: { WARP: 0, FILLING: 0, SELVEDGE: 0, OTHER: 0 }, rpmSum: 0, rpmN: 0 },
    bootAt: now,
  };
}

function envelope(sim, schema, data, tsMs, extra = {}) {
  sim.seq += 1;
  return {
    schema,
    msgId: generateUuidV7(tsMs),
    seq: sim.seq,
    bootId: sim.bootId,
    deviceId: sim.deviceId,
    machineId: sim.machineId,
    gatewayId: 'none',
    source: 'LDL',
    ts: iso(tsMs),
    tsQuality: 'SYNCED',
    replayed: false,
    data,
    ...extra,
  };
}

function stateData(sim) {
  return {
    state: sim.state,
    stopCategory: sim.stopCategory,
    stopId: sim.stopId,
    since: iso(sim.since),
    rpm: sim.state === 'RUNNING' ? Math.round(sim.rpm * 10) / 10 : 0,
    picksTotal: sim.picksTotal,
  };
}

/** Advance the simulated loom to `now`; returns the envelopes produced. */
function step(sim, now) {
  const out = [];
  const dt = now - sim.lastTick;
  sim.lastTick = now;
  const w = sim.window;

  if (sim.state === 'RUNNING') {
    const picks = Math.round((sim.rpm * dt) / 60000);
    sim.picksTotal += picks;
    w.picks += picks; w.runMs += dt; w.rpmSum += sim.rpm; w.rpmN++;
    sim.rpm = Math.min(900, Math.max(820, sim.rpm + (Math.random() - 0.5) * 6));
    if (Math.random() < 0.08) {
      sim.state = 'STOPPED';
      sim.stopCategory = CATS[Math.floor(Math.random() * CATS.length)];
      sim.stopId = generateUuidV7(now);
      sim.since = now;
      sim.failedStarts = 0;
      w.stops[sim.stopCategory]++;
      out.push(envelope(sim, 'ahi.loom.event/1.0', {
        eventType: 'STOP_STARTED', stopId: sim.stopId, stopCategory: sim.stopCategory,
        detectedAt: iso(now), picksTotal: sim.picksTotal,
      }, now));
    }
  } else {
    w.stopMs += dt;
    if (Math.random() < 0.05) {
      sim.failedStarts++;
      out.push(envelope(sim, 'ahi.loom.event/1.0', {
        eventType: 'START_ATTEMPT_FAILED', stopId: sim.stopId, stopCategory: sim.stopCategory,
        detectedAt: iso(now), failedStartAttempts: sim.failedStarts,
      }, now));
    } else if (Math.random() < 0.3) {
      out.push(envelope(sim, 'ahi.loom.event/1.0', {
        eventType: 'STOP_ENDED', stopId: sim.stopId, stopCategory: sim.stopCategory,
        durationMs: now - sim.since, failedStartAttempts: sim.failedStarts, picksTotal: sim.picksTotal,
      }, now));
      sim.state = 'RUNNING';
      sim.stopCategory = null;
      sim.stopId = null;
      sim.since = now;
    }
  }

  // state heartbeat every tick (also covers state changes)
  out.push(envelope(sim, 'ahi.loom.state/1.0', stateData(sim), now));

  // minute boundary -> counters + health
  const minute = Math.floor(now / 60000) * 60000;
  if (minute > w.start) {
    out.push(envelope(sim, 'ahi.loom.counters/1.0', {
      windowStart: iso(w.start), windowEnd: iso(minute),
      picksDelta: w.picks, picksTotal: sim.picksTotal,
      runMs: w.runMs, stopMs: w.stopMs, offlineMs: 0, stops: { ...w.stops },
      rpmAvgRunning: w.rpmN ? Math.round((w.rpmSum / w.rpmN) * 10) / 10 : 0,
    }, now));
    out.push(envelope(sim, 'ahi.device.health/1.0', {
      status: 'ONLINE', ipAddress: '10.0.0.' + (10 + looms.indexOf(sim.cfg)), firmwareVersion: 'sim-http 1.0',
      uptimeSeconds: Math.floor((now - sim.bootAt) / 1000), lastError: null, bootId: sim.bootId,
      bufferType: 'ram', bufferBacklog: 0, clockSynced: !skewMs, linkUp: true,
    }, now));
    sim.window = { start: minute, picks: 0, runMs: 0, stopMs: 0, stops: { WARP: 0, FILLING: 0, SELVEDGE: 0, OTHER: 0 }, rpmSum: 0, rpmN: 0 };
  }
  return out;
}

function replayBacklog(sim) {
  const out = [];
  const base = Date.now() - 15 * 60 * 1000;
  for (let i = 0; i < 10; i++) {
    const t = base + i * 30_000;
    out.push(envelope(sim, 'ahi.loom.state/1.0', { ...stateData(sim), since: iso(base) }, t,
      { replayed: true, tsQuality: 'ESTIMATED' }));
  }
  return out;
}

async function post(sim, envelopes) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${sim.token}` },
    body: JSON.stringify({ deviceId: sim.deviceId, envelopes }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, body };
}

function summarise(results) {
  const c = {};
  for (const r of results || []) c[r.status] = (c[r.status] || 0) + 1;
  return Object.entries(c).map(([k, v]) => `${k}=${v}`).join(' ');
}

async function send(sim, envelopes, label) {
  for (let i = 0; i < envelopes.length; i += 50) {
    const chunk = envelopes.slice(i, i + 50);
    const r = await post(sim, chunk);
    const rejected = (r.body?.results || []).filter((x) => x.status === 'rejected');
    console.log(`[${new Date().toISOString()}] ${sim.machineId} ${label} HTTP ${r.status} ${r.body?.results ? summarise(r.body.results) : JSON.stringify(r.body)}`);
    for (const x of rejected) console.log(`    rejected ${x.msgId}: ${x.reason}`);
    if (args.dup && r.status === 200) {
      const again = await post(sim, chunk);
      const allDup = (again.body?.results || []).every((x) => x.status === 'duplicate' || x.status === 'rejected');
      console.log(`    dup re-send HTTP ${again.status} ${summarise(again.body?.results)} ${allDup ? 'OK' : 'UNEXPECTED'}`);
    }
  }
}

const sims = looms.map((cfg) => ({ ...makeSim(cfg), cfg }));
console.log(`Posting to ${endpoint} for ${sims.length} loom(s), every ${intervalMs} ms${args.dup ? ', --dup' : ''}${args.replay ? ', --replay' : ''}${skewMs ? ', --skew' : ''}`);

for (const sim of sims) {
  if (args.replay) await send(sim, replayBacklog(sim), 'replay-backlog');
}

let ticks = 0;
async function tick() {
  ticks++;
  const now = Date.now();
  await Promise.all(sims.map((sim) => send(sim, step(sim, now), 'live').catch((e) => {
    console.error(`${sim.machineId}: ${e.message}`);
  })));
  if (ticks >= maxTicks) process.exit(0);
  setTimeout(tick, intervalMs);
}
tick();
