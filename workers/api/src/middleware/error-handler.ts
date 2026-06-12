import type { Context } from 'hono';
import type { Env } from '../types/env.js';
import { AppError } from '../utils/errors.js';
import { ZodError } from 'zod';

export function errorHandler(
  err: unknown,
  c: Context<{ Bindings: Env }>,
): Response {
  if (err instanceof AppError) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details && { details: err.details }),
        },
      },
      err.statusCode as any,
    );
  }

  if (err instanceof ZodError) {
    const fieldErrors = err.errors.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));

    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Validation failed',
          details: { fields: fieldErrors },
        },
      },
      400,
    );
  }

  console.error('Unhandled error:', err);
  const message = err instanceof Error ? err.message : 'An unexpected error occurred';

  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message:
          c.env.ENVIRONMENT === 'production'
            ? 'An internal error occurred'
            : message,
      },
    },
    500,
  );
}
