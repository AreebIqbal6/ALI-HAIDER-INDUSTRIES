import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as declareStop } from '@/app/api/operator/declare-stop/route';
import { POST as configureLoom } from '@/app/api/operator/configure-loom/route';
import { clearAllLooms, updateLoomTelemetry, getLocalStoreSnapshot } from '@/lib/localStore';

function mkReq(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('operator routes (/api/operator/*)', () => {
  beforeEach(() => {
    clearAllLooms();
    vi.stubEnv('NEXT_PUBLIC_ENABLE_SUPABASE', 'false');
    vi.stubEnv('OPERATOR_API_KEY', '');
  });

  afterEach(() => {
    clearAllLooms();
    vi.unstubAllEnvs();
  });

  it('rejects malformed JSON and invalid payloads with 400', async () => {
    const r1 = await declareStop(mkReq('http://localhost/api/operator/declare-stop', '{bad'));
    expect(r1.status).toBe(400);

    const r2 = await declareStop(
      mkReq('http://localhost/api/operator/declare-stop', { machineId: 'PIC-1', reasonCode: 'BAD' }),
    );
    expect(r2.status).toBe(400);

    const r3 = await configureLoom(
      mkReq('http://localhost/api/operator/configure-loom', { machineId: 'PIC-1', setRpm: 99999 }),
    );
    expect(r3.status).toBe(400);
  });

  it('blocks cross-site CSRF POSTs with 403', async () => {
    const r = await declareStop(
      mkReq(
        'http://localhost/api/operator/declare-stop',
        { machineId: 'PIC-427708', reasonCode: 'KNT' },
        { 'sec-fetch-site': 'cross-site' },
      ),
    );
    expect(r.status).toBe(403);
  });

  it('enforces OPERATOR_API_KEY when configured', async () => {
    vi.stubEnv('OPERATOR_API_KEY', 'op-secret-123456');
    updateLoomTelemetry({
      machineId: 'PIC-427708',
      deviceId: 'e0e2e6aabbcc',
      state: 'STOPPED',
      stopCategory: 'WARP',
      rpm: 0,
    });

    const unauth = await declareStop(
      mkReq('http://localhost/api/operator/declare-stop', {
        machineId: 'PIC-427708',
        reasonCode: 'KNT',
      }),
    );
    expect(unauth.status).toBe(401);

    const wrong = await configureLoom(
      mkReq(
        'http://localhost/api/operator/configure-loom',
        { machineId: 'PIC-427708', setRpm: 880 },
        { 'x-operator-key': 'wrong-key' },
      ),
    );
    expect(wrong.status).toBe(401);

    const ok = await declareStop(
      mkReq(
        'http://localhost/api/operator/declare-stop',
        { machineId: 'PIC-427708', reasonCode: 'KNT', notes: 'Knotting beam' },
        { 'x-operator-key': 'op-secret-123456' },
      ),
    );
    expect(ok.status).toBe(200);
  });

  it('returns 404 for unknown machineId and updates registered looms cleanly', async () => {
    const missingStop = await declareStop(
      mkReq('http://localhost/api/operator/declare-stop', {
        machineId: 'PIC-UNKNOWN',
        reasonCode: 'MEC',
      }),
    );
    expect(missingStop.status).toBe(404);

    const missingCfg = await configureLoom(
      mkReq('http://localhost/api/operator/configure-loom', {
        machineId: 'PIC-UNKNOWN',
        loomNumber: 5,
      }),
    );
    expect(missingCfg.status).toBe(404);

    updateLoomTelemetry({
      machineId: 'PIC-427708',
      deviceId: 'e0e2e6aabbcc',
      state: 'STOPPED',
      stopCategory: 'FILLING',
      rpm: 0,
    });

    const stopRes = await declareStop(
      mkReq('http://localhost/api/operator/declare-stop', {
        machineId: 'PIC-427708',
        stopId: 'stp-non-uuid',
        reasonCode: 'ART',
        notes: 'Article changeover',
        operatorName: 'Akram',
      }),
    );
    expect(stopRes.status).toBe(200);

    const cfgRes = await configureLoom(
      mkReq('http://localhost/api/operator/configure-loom', {
        machineId: 'PIC-427708',
        loomNumber: 12,
        family: 'OmniPlus Summum',
        setRpm: 910,
        weftDensity: 28.5,
      }),
    );
    expect(cfgRes.status).toBe(200);

    const snap = getLocalStoreSnapshot();
    const loom = snap.looms.find((l) => l.machine_id === 'PIC-427708');
    expect(loom?.loom_number).toBe(12);
    expect(loom?.family).toBe('OmniPlus Summum');
    expect(loom?.set_rpm).toBe(910);
    expect(loom?.liveState.operator_reason).toBe('ART');
    expect(loom?.liveState.operator_note).toBe('Article changeover');
  });

  it('returns 409 on duplicate loomNumber and 413 on oversized operator payloads', async () => {
    updateLoomTelemetry({
      machineId: 'PIC-100001',
      deviceId: 'dev-100001',
      state: 'RUNNING',
      stopCategory: null,
      rpm: 860,
    });
    updateLoomTelemetry({
      machineId: 'PIC-100002',
      deviceId: 'dev-100002',
      state: 'RUNNING',
      stopCategory: null,
      rpm: 860,
    });

    const dupRes = await configureLoom(
      mkReq('http://localhost/api/operator/configure-loom', {
        machineId: 'PIC-100002',
        loomNumber: 1,
      }),
    );
    expect(dupRes.status).toBe(409);

    const bigStop = await declareStop(
      mkReq('http://localhost/api/operator/declare-stop', {
        machineId: 'PIC-100001',
        reasonCode: 'KNT',
        notes: 'x'.repeat(20_000),
      }),
    );
    expect(bigStop.status).toBe(413);

    const bigCfg = await configureLoom(
      mkReq('http://localhost/api/operator/configure-loom', {
        machineId: 'PIC-100001',
        articleName: 'y'.repeat(20_000),
      }),
    );
    expect(bigCfg.status).toBe(413);
  });

  it('accepts declaredBy alias on declare-stop for pilot verification compatibility', async () => {
    updateLoomTelemetry({
      machineId: 'PIC-200001',
      deviceId: 'dev-200001',
      state: 'STOPPED',
      stopCategory: 'WARP',
      rpm: 0,
    });
    const res = await declareStop(
      mkReq('http://localhost/api/operator/declare-stop', {
        machineId: 'PIC-200001',
        reasonCode: 'MEC',
        declaredBy: 'Akram Khan',
      }),
    );
    expect(res.status).toBe(200);
  });

  it('rate-limits operator endpoints after 30 requests per IP', async () => {
    updateLoomTelemetry({
      machineId: 'PIC-427708',
      deviceId: 'e0e2e6aabbcc',
      state: 'STOPPED',
      stopCategory: 'WARP',
      rpm: 0,
    });
    const ipHeader = { 'x-real-ip': '198.51.100.77' };
    let got429 = false;
    for (let i = 0; i < 35; i++) {
      const r = await declareStop(
        mkReq(
          'http://localhost/api/operator/declare-stop',
          { machineId: 'PIC-427708', reasonCode: 'KNT' },
          ipHeader,
        ),
      );
      if (r.status === 429) {
        got429 = true;
        expect(r.headers.get('Retry-After')).toBe('60');
        break;
      }
    }
    expect(got429).toBe(true);
  });
});
