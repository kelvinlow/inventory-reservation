import type { Context, Next } from 'hono';
import type { Env } from '../types/env.js';

/**
 * Simple in-memory sliding window rate limiter.
 * In production, you'd use Cloudflare's built-in rate limiting or
 * a Durable Object-backed rate limiter. This provides basic
 * per-worker protection.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Per-worker in-memory store (resets on worker restart)
const store = new Map<string, RateLimitEntry>();

// Clean up stale entries periodically
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 60_000;

function cleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, entry] of store) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function rateLimiter(
  maxRequests: number = 100,
  windowMs: number = 60_000,
) {
  return async (c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> => {
    cleanup();

    // Use CF-Connecting-IP or fallback
    const ip =
      c.req.header('cf-connecting-ip') ??
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown';

    const key = `rl:${ip}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    const remaining = Math.max(0, maxRequests - entry.count);
    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests, please try again later',
          },
        },
        429,
      );
    }

    await next();
  };
}
