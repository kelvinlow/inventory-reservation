import type { ErrorCode } from '../types/index.js';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class InsufficientStockError extends AppError {
  constructor(available: number, requested: number) {
    super('INSUFFICIENT_STOCK', 'Not enough stock available', 409, {
      available,
      requested,
    });
  }
}

export class ReservationNotFoundError extends AppError {
  constructor(reservationId: string) {
    super('RESERVATION_NOT_FOUND', `Reservation ${reservationId} not found`, 404, {
      reservation_id: reservationId,
    });
  }
}

export class ReservationExpiredError extends AppError {
  constructor(reservationId: string) {
    super('RESERVATION_EXPIRED', `Reservation ${reservationId} has expired`, 410, {
      reservation_id: reservationId,
    });
  }
}

export class ProductNotFoundError extends AppError {
  constructor(identifier: string) {
    super('PRODUCT_NOT_FOUND', `Product ${identifier} not found`, 404, {
      identifier,
    });
  }
}

export class AlreadyConfirmedError extends AppError {
  constructor(reservationId: string) {
    super('ALREADY_CONFIRMED', `Reservation ${reservationId} is already confirmed`, 409, {
      reservation_id: reservationId,
    });
  }
}

export class AlreadyCancelledError extends AppError {
  constructor(reservationId: string) {
    super('ALREADY_CANCELLED', `Reservation ${reservationId} is already cancelled`, 409, {
      reservation_id: reservationId,
    });
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(idempotencyKey: string) {
    super(
      'IDEMPOTENCY_CONFLICT',
      'A different request was already processed with this idempotency key',
      409,
      { idempotency_key: idempotencyKey },
    );
  }
}

export class InvalidRequestError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_REQUEST', message, 400, details);
  }
}

export class RateLimitedError extends AppError {
  constructor() {
    super('RATE_LIMITED', 'Too many requests, please try again later', 429);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class InternalError extends AppError {
  constructor(message: string = 'An internal error occurred') {
    super('INTERNAL_ERROR', message, 500);
  }
}
