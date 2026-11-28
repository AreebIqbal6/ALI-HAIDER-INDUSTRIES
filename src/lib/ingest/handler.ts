// POST /api/ingest/v1/batch — Data Contract v1 handler (framework-agnostic: Request -> Response).
import {
  BatchRequestShellSchema,
  MAX_ENVELOPES_PER_BATCH,
  type BatchResponse,
  type BatchResult,
} from '@/lib/contract';
import { authenticateDevice, parseBearer } from './auth';
import { ingestEnvelope } from './ingest';
import { createRateLimiter, DEVICE_RATE_LIMIT_PER_MIN, type RateLimiter } from './rateLimit';
import { TransientIngestError, type IngestStore } from './types';
import { validateEnvelope } from './validate';
import {
  LEGACY_KEY_HEADER,
  isLegacyIngestEnabled,
  isValidLegacyKey,
  processLegacyBody,
} from './legacy';

/** Generous cap: 50 envelopes are ~30 KB; anything near this is not a logger. */
export const MAX_BODY_BYTES = 256 * 1024;

export interface BatchHandlerDeps {
  /** null when the store is not configured (Supabase disabled / no service key) */
  getStore: () => IngestStore | null;
  rateLimiter?: RateLimiter;
  now?: () => Date;
}

function json(body: unknown, status: number, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders },
  });
}

function getClientIp(req: Request): string {
  const vercelIp = req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  if (vercelIp) return vercelIp;
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return 'local';
}

async function readJsonBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, status: 413 };
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, status: 400 };
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return { ok: false, status: 413 };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400 };
  }
}

export function createBatchHandler(deps: BatchHandlerDeps) {
  const limiter =
    deps.rateLimiter ?? createRateLimiter({ limit: DEVICE_RATE_LIMIT_PER_MIN, windowMs: 60_000 });
  const ipPreAuthLimiter = deps.rateLimiter
    ? null
    : createRateLimiter({ limit: 600, windowMs: 60_000 });
  const now = deps.now ?? (() => new Date());

  return async function handle(req: Request): Promise<Response> {
    const authHeader = req.headers.get('authorization');
    const legacyKey = req.headers.get(LEGACY_KEY_HEADER);
    const ip = getClientIp(req);

    // ---- Legacy path (opt-in via LEGACY_INGEST_KEY, no bearer token) ----------
    if (!authHeader && legacyKey !== null) {
      if (!isLegacyIngestEnabled() || !isValidLegacyKey(legacyKey)) {
        return json({ error: 'unauthorized' }, 401);
      }
      if (!limiter.check(`legacy:${ip}`)) {
        return json({ error: 'rate limit exceeded' }, 429, { 'retry-after': '60' });
      }
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return json({ error: parsed.status === 413 ? 'payload too large' : 'invalid JSON body' }, parsed.status);
      const [status, body] = processLegacyBody(parsed.body);
      return json(body, status);
    }

    // ---- Contract v1 path ----------------------------------------------------
    if (ipPreAuthLimiter && !ipPreAuthLimiter.check(`ip:${ip}`)) {
      return json({ error: 'rate limit exceeded' }, 429, { 'retry-after': '60' });
    }

    const token = parseBearer(authHeader);
    if (!token) return json({ error: 'unauthorized' }, 401);

    const parsed = await readJsonBody(req);
    if (!parsed.ok) {
      return json({ error: parsed.status === 413 ? 'payload too large' : 'invalid JSON body' }, parsed.status);
    }
    const shell = BatchRequestShellSchema.safeParse(parsed.body);
    if (!shell.success) return json({ error: 'body must be {deviceId, envelopes[]}' }, 400);
    if (shell.data.envelopes.length > MAX_ENVELOPES_PER_BATCH) {
      return json({ error: `too many envelopes (max ${MAX_ENVELOPES_PER_BATCH})` }, 413);
    }

    const store = deps.getStore();
    if (!store) return json({ error: 'ingest store not configured' }, 503, { 'retry-after': '60' });

    let auth;
    try {
      auth = await authenticateDevice(store, token, shell.data.deviceId);
    } catch {
      return json({ error: 'store unavailable' }, 503, { 'retry-after': '5' });
    }
    if (!auth.ok) return json({ error: 'unauthorized' }, 401);
    const device = auth.device;

    if (!limiter.check(`device:${device.deviceId}`)) {
      return json({ error: 'rate limit exceeded' }, 429, { 'retry-after': '60' });
    }

    const receivedAt = now();
    const results: BatchResult[] = [];
    try {
      for (const raw of shell.data.envelopes) {
        const v = validateEnvelope(raw, device);
        if (!v.ok) {
          results.push({ msgId: v.msgId, status: 'rejected', reason: v.reason });
          continue;
        }
        const outcome = await ingestEnvelope(store, v.env, receivedAt);
        results.push(
          outcome.reason
            ? { msgId: v.msgId, status: outcome.status, reason: outcome.reason }
            : { msgId: v.msgId, status: outcome.status },
        );
      }
    } catch (err) {
      // Already-stored messages come back as 'duplicate' on retry, so a 503 is safe.
      const transient = err instanceof TransientIngestError;
      console.error('[ingest] batch aborted:', transient ? err.message : err);
      return json({ error: 'store unavailable' }, 503, { 'retry-after': '5' });
    }

    const response: BatchResponse = { serverTime: now().toISOString(), results };
    return json(response, 200);
  };
}
