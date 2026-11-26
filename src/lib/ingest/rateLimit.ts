// Fixed-window per-key rate limiter (in-memory, per server instance).
// On serverless hosts each instance keeps its own window, so the effective limit is
// "per device per instance" — good enough to stop a runaway logger loop.

export interface RateLimiter {
  /** true = allowed, false = over the limit */
  check(key: string): boolean;
}

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}): RateLimiter {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    check(key: string): boolean {
      const t = now();
      const rec = windows.get(key);
      if (!rec || t >= rec.resetAt) {
        if (windows.size >= maxKeys) {
          for (const [k, v] of windows) if (t >= v.resetAt) windows.delete(k);
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value as string);
        }
        windows.set(key, { count: 1, resetAt: t + opts.windowMs });
        return true;
      }
      if (rec.count >= opts.limit) return false;
      rec.count++;
      return true;
    },
  };
}

export const DEVICE_RATE_LIMIT_PER_MIN = 120;
