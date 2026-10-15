import type { RequestHandler } from "express";

export interface RateLimitOptions {
  now?: () => number;
  maxKeys?: number;
  windowMs?: number;
  onLimited?: RequestHandler;
}

export function makeRateLimiter(limit: number, { now = Date.now, maxKeys = 2_048, windowMs = 600_000, onLimited }: RateLimitOptions = {}): RequestHandler {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const time = now();
    for (const [key, entry] of attempts) if (entry.resetAt <= time) attempts.delete(key);
    // The bundled Vite proxy does not provide a validated client IP, so local clients share its socket bucket.
    // Do not trust caller-supplied forwarding headers. This is a bounded local safety gate.
    const key = req.socket.remoteAddress ?? "unknown";
    let entry = attempts.get(key);
    if (!entry) {
      if (attempts.size >= maxKeys) attempts.delete(attempts.keys().next().value!);
      entry = { count: 0, resetAt: time + windowMs };
      attempts.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.setHeader("Retry-After", Math.ceil((entry.resetAt - time) / 1_000));
      onLimited?.(req, res, next);
      res.status(429).json({ error: { code: "rate_limited", message: "Too many attempts; try again later" } });
      return;
    }
    next();
  };
}
