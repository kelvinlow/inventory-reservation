import type { Context } from 'hono';
import type { ApiSuccessResponse, ApiErrorResponse } from '../types/index.js';

/**
 * Send a success response with consistent formatting.
 */
export function success<T>(c: Context, data: T, statusCode: number = 200): Response {
  const body: ApiSuccessResponse<T> = { data };
  return c.json(body, statusCode as any);
}

/**
 * Send an error response with consistent formatting.
 */
export function error(
  c: Context,
  code: string,
  message: string,
  statusCode: number = 400,
  details?: Record<string, unknown>,
): Response {
  const body: ApiErrorResponse = {
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };
  return c.json(body, statusCode as any);
}

/**
 * Send a paginated success response.
 */
export function paginated<T>(
  c: Context,
  data: T[],
  total: number,
  page: number,
  limit: number,
): Response {
  return c.json(
    {
      data,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    },
    200,
  );
}
