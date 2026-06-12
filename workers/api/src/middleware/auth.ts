import type { Context, Next } from 'hono';
import type { Env } from '../types/env.js';
import { AppError, UnauthorizedError } from '../utils/errors.js';

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);

  let mismatch = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

function getPresentedKey(c: Context<{ Bindings: Env }>): string | null {
  const bearer = c.req.header('Authorization');
  if (bearer?.startsWith('Bearer ')) {
    return bearer.slice('Bearer '.length).trim();
  }

  return c.req.header('X-API-Key') ?? c.req.header('x-api-key') ?? null;
}

export function requireApiKey(binding: 'ADMIN_API_KEY' | 'INTERNAL_API_KEY') {
  return async (c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> => {
    const configuredKey = c.env[binding];
    if (!configuredKey) {
      throw new AppError(
        'INTERNAL_ERROR',
        `Missing required secret binding: ${binding}`,
        503,
      );
    }

    const presentedKey = getPresentedKey(c);
    if (!presentedKey || !constantTimeEqual(presentedKey, configuredKey)) {
      throw new UnauthorizedError();
    }

    await next();
  };
}
