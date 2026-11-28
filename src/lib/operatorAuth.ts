import type { NextRequest } from 'next/server';
import { createRateLimiter, safeEqual } from '@/lib/ingest';
import { getServiceSupabase } from '@/lib/supabase';

const operatorLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

export function getOperatorClientIp(req: NextRequest): string {
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

export function checkOperatorRateLimit(req: NextRequest): boolean {
  return operatorLimiter.check(`op:${getOperatorClientIp(req)}`);
}

const MAX_OPERATOR_BODY_BYTES = 16 * 1024;

export async function readBoundedJsonBody(
  req: NextRequest,
  maxBytes = MAX_OPERATOR_BODY_BYTES,
): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413; error: string }> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: 'Payload too large' };
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return { ok: false, status: 413, error: 'Payload too large' };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }
}

export async function authorizeOperatorRequest(
  req: NextRequest,
): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') {
    return { ok: false, status: 403, error: 'Cross-site operator requests are forbidden' };
  }

  const configuredKey = process.env.OPERATOR_API_KEY;
  if (!configuredKey) {
    return { ok: true };
  }

  const keyHeader = req.headers.get('x-operator-key');
  if (safeEqual(keyHeader, configuredKey)) {
    return { ok: true };
  }

  const authHeader = req.headers.get('authorization');
  const match = authHeader ? /^Bearer\s+(\S+)\s*$/i.exec(authHeader) : null;
  if (match) {
    const supabase = getServiceSupabase();
    if (supabase) {
      const { data, error } = await supabase.auth.getUser(match[1]);
      if (!error && data.user) {
        return { ok: true };
      }
    }
  }

  return { ok: false, status: 401, error: 'Unauthorized operator action' };
}
