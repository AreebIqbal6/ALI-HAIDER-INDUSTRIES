import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  PermanentIngestError,
  TransientIngestError,
  createBatchHandler,
  createRateLimiter,
  hashToken,
  type DeviceRecord,
  type IngestStore,
  type StoreStatus,
  type StoredEnvelope,
} from '@/lib/ingest';

const EXAMPLES = path.resolve(__dirname, '..', 'contract', 'v1', 'examples');
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(EXAMPLES, name), 'utf8'));

const TOKEN = 'test-device-token-0123456789abcdef'; // test fixture, not a real credential
const DEVICE: DeviceRecord = { deviceId: 'e0e2e6aabbcc', machineId: 'PIC-427708', status: 'active' };
const RECEIVED = new Date('2026-11-26T09:17:01.000Z');

class MockStore implements IngestStore {
  devices = new Map<string, DeviceRecord>([[hashToken(TOKEN), { ...DEVICE }]]);
  seen = new Set<string>();
  forced = new Map<string, StoreStatus | Error>();
  calls: StoredEnvelope[] = [];

  async findDeviceByTokenHash(h: string) {
    return this.devices.get(h) ?? null;
  }
  async ingestMessage(env: StoredEnvelope): Promise<StoreStatus> {
    this.calls.push(env);
    const f = this.forced.get(env.msgId);
    if (f instanceof Error) throw f;
    if (this.seen.has(env.msgId)) return 'duplicate';
    this.seen.add(env.msgId);
    return f ?? 'stored';
  }
}

function req(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) {
  return new Request('http://localhost/api/ingest/v1/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

let store: MockStore;
let handle: (r: Request) => Promise<Response>;
beforeEach(() => {
  store = new MockStore();
  handle = createBatchHandler({ getStore: () => store, now: () => RECEIVED });
});

describe('authentication', () => {
  it('401 without Authorization header', async () => {
    expect((await handle(req(load('batch_request.json'), {}))).status).toBe(401);
  });
  it('401 with a wrong token', async () => {
    const r = await handle(req(load('batch_request.json'), { authorization: 'Bearer wrong-token-wrong-token-xx' }));
    expect(r.status).toBe(401);
  });
  it('401 with a malformed Authorization header', async () => {
    const r = await handle(req(load('batch_request.json'), { authorization: TOKEN }));
    expect(r.status).toBe(401);
  });
  it('401 when the device is disabled', async () => {
    store.devices.get(hashToken(TOKEN))!.status = 'disabled';
    expect((await handle(req(load('batch_request.json')))).status).toBe(401);
  });
  it('401 when body deviceId does not match the token', async () => {
    const body = { ...load('batch_request.json'), deviceId: 'ffffffffffff' };
    expect((await handle(req(body))).status).toBe(401);
  });
  it('503 when the store is not configured', async () => {
    const h = createBatchHandler({ getStore: () => null });
    expect((await h(req(load('batch_request.json')))).status).toBe(503);
  });
});

describe('request shape', () => {
  it('400 for unparseable JSON', async () => {
    expect((await handle(req('{not json'))).status).toBe(400);
  });
  it('400 for a body without envelopes', async () => {
    expect((await handle(req({ deviceId: DEVICE.deviceId }))).status).toBe(400);
  });
  it('413 for more than 50 envelopes', async () => {
    const env = load('state.json');
    const r = await handle(req({ deviceId: DEVICE.deviceId, envelopes: Array(51).fill(env) }));
    expect(r.status).toBe(413);
    expect(store.calls).toHaveLength(0);
  });
});

describe('result mapping', () => {
  it('stores the golden batch and reports duplicates on retry', async () => {
    const body = load('batch_request.json');
    const first = await handle(req(body));
    expect(first.status).toBe(200);
    const j1 = await first.json();
    expect(j1.serverTime).toBe(RECEIVED.toISOString());
    expect(j1.results.map((r: { status: string }) => r.status)).toEqual(['stored', 'stored', 'stored', 'stored']);
    expect(j1.results.map((r: { msgId: string }) => r.msgId)).toEqual(
      body.envelopes.map((e: { msgId: string }) => e.msgId),
    );

    const j2 = await (await handle(req(body))).json();
    expect(j2.results.every((r: { status: string }) => r.status === 'duplicate')).toBe(true);
  });

  it("maps internal 'stale' to 'stored' for the device", async () => {
    const env = load('state.json');
    store.forced.set(env.msgId, 'stale');
    const j = await (await handle(req({ deviceId: DEVICE.deviceId, envelopes: [env] }))).json();
    expect(j.results).toEqual([{ msgId: env.msgId, status: 'stored' }]);
  });

  it('rejects an envelope whose machineId does not match the registration', async () => {
    const env = { ...load('health.json'), machineId: 'PIC-999999' };
    const j = await (await handle(req({ deviceId: DEVICE.deviceId, envelopes: [env] }))).json();
    expect(j.results[0]).toEqual({
      msgId: env.msgId,
      status: 'rejected',
      reason: 'machineId does not match device registration',
    });
    expect(store.calls).toHaveLength(0);
  });

  it('rejects invalid envelopes individually and keeps the rest', async () => {
    const good = load('counters.json');
    const bad = { ...load('state.json'), seq: 0 };
    const j = await (await handle(req({ deviceId: DEVICE.deviceId, envelopes: [bad, good] }))).json();
    expect(j.results[0].status).toBe('rejected');
    expect(j.results[0].reason).toMatch(/seq/);
    expect(j.results[1]).toEqual({ msgId: good.msgId, status: 'stored' });
  });

  it("maps store 'rejected' and permanent DB errors to rejected", async () => {
    const a = load('state.json');
    const b = load('counters.json');
    store.forced.set(a.msgId, 'rejected');
    store.forced.set(b.msgId, new PermanentIngestError('22P02'));
    const j = await (await handle(req({ deviceId: DEVICE.deviceId, envelopes: [a, b] }))).json();
    expect(j.results.map((r: { status: string }) => r.status)).toEqual(['rejected', 'rejected']);
  });

  it('503 (device keeps its buffer) on transient store errors', async () => {
    const env = load('state.json');
    store.forced.set(env.msgId, new TransientIngestError('connection reset'));
    expect((await handle(req({ deviceId: DEVICE.deviceId, envelopes: [env] }))).status).toBe(503);
  });

  it('applies the skew rule before storing', async () => {
    const env = { ...load('state.json'), ts: '2026-11-26T09:30:00.000Z' }; // 13 min ahead
    await handle(req({ deviceId: DEVICE.deviceId, envelopes: [env] }));
    expect(store.calls[0].tsQuality).toBe('ESTIMATED');
    expect(store.calls[0].clockSkewed).toBe(true);
    expect(store.calls[0].ts).toBe(env.ts); // original ts is preserved
  });

  it('does not touch tsQuality for normal timestamps', async () => {
    await handle(req({ deviceId: DEVICE.deviceId, envelopes: [load('state.json')] }));
    expect(store.calls[0].tsQuality).toBe('SYNCED');
    expect(store.calls[0].clockSkewed).toBeUndefined();
  });
});

describe('rate limiting', () => {
  it('429 once the per-device limit is exceeded', async () => {
    const h = createBatchHandler({
      getStore: () => store,
      now: () => RECEIVED,
      rateLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }),
    });
    const body = { deviceId: DEVICE.deviceId, envelopes: [] };
    expect((await h(req(body))).status).toBe(200);
    expect((await h(req(body))).status).toBe(200);
    expect((await h(req(body))).status).toBe(429);
  });

  it('window resets after windowMs', () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(rl.check('a')).toBe(true);
    expect(rl.check('a')).toBe(false);
    expect(rl.check('b')).toBe(true);
    t = 1000;
    expect(rl.check('a')).toBe(true);
  });
});

describe('legacy x-weavesync-key path', () => {
  const frame = { deviceId: 'legacy-dev', machineId: 'PIC-111111', pins: { piStrt: 1 }, rpm: 800 };
  afterEach(() => vi.unstubAllEnvs());

  it('is disabled by default (401 even with a plausible key)', async () => {
    vi.stubEnv('LEGACY_INGEST_KEY', '');
    const r = await handle(req(frame, { 'x-weavesync-key': 'anything-at-all' }));
    expect(r.status).toBe(401);
  });

  it('rejects a wrong key when enabled', async () => {
    vi.stubEnv('LEGACY_INGEST_KEY', 'legacy-test-key');
    const r = await handle(req(frame, { 'x-weavesync-key': 'legacy-test-kez' }));
    expect(r.status).toBe(401);
  });
});

describe('route module', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('POST without Supabase configured: bearer -> 503, legacy key -> 401', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_SUPABASE', 'false');
    const { POST } = await import('@/app/api/ingest/v1/batch/route');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (r: Request) => POST(r as any);
    expect((await call(req(load('batch_request.json')))).status).toBe(503);
    expect((await call(req(load('batch_request.json'), { 'x-weavesync-key': 'x' }))).status).toBe(401);
  });

  it('DELETE requires ADMIN_API_KEY', async () => {
    const { DELETE } = await import('@/app/api/ingest/v1/batch/route');
    const { NextRequest } = await import('next/server');
    const mk = (h: Record<string, string>) =>
      new NextRequest('http://localhost/api/ingest/v1/batch?id=PIC-000000', { method: 'DELETE', headers: h });
    vi.stubEnv('ADMIN_API_KEY', '');
    expect((await DELETE(mk({ 'x-admin-key': '' }))).status).toBe(401);
    vi.stubEnv('ADMIN_API_KEY', 'admin-test-key');
    expect((await DELETE(mk({ 'x-admin-key': 'wrong' }))).status).toBe(401);
    expect((await DELETE(mk({ 'x-admin-key': 'admin-test-key' }))).status).toBe(200);
  });
});
