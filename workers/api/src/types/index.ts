// ─── Product ────────────────────────────────────────────────────────

export type ProductStatus = 'active' | 'inactive' | 'archived';

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
}

export interface ProductWithStock extends Product {
  total_stock: number;
  reserved_count: number;
  confirmed_count: number;
  available_stock: number;
}

// ─── Inventory ──────────────────────────────────────────────────────

export interface Inventory {
  sku_id: string;
  total_stock: number;
  reserved_count: number;
  confirmed_count: number;
  version: number;
  updated_at: string;
}

export interface InventorySnapshot {
  sku_id: string;
  total_stock: number;
  reserved_count: number;
  confirmed_count: number;
  available_stock: number;
  version: number;
}

// ─── Reservation ────────────────────────────────────────────────────

export type ReservationStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';

export interface Reservation {
  id: string;
  sku_id: string;
  user_id: string | null;
  quantity: number;
  status: ReservationStatus;
  expires_at: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

// ─── Order ──────────────────────────────────────────────────────────

export type OrderStatus = 'completed' | 'refunded';

export interface Order {
  id: string;
  reservation_id: string;
  status: OrderStatus;
  payment_reference: string | null;
  confirmation_idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Audit Log ──────────────────────────────────────────────────────

export type EntityType = 'product' | 'inventory' | 'reservation' | 'order';
export type AuditAction =
  | 'product.created'
  | 'product.updated'
  | 'inventory.adjusted'
  | 'reservation.created'
  | 'reservation.confirmed'
  | 'reservation.cancelled'
  | 'reservation.expired'
  | 'order.created'
  | 'order.refunded';
export type ActorType = 'user' | 'system' | 'admin';

export interface AuditLogEntry {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  action: AuditAction;
  actor_type: ActorType;
  actor_id: string | null;
  payload_json: string;
  created_at: string;
}

// ─── API Request/Response Types ─────────────────────────────────────

export interface CreateReservationRequest {
  sku: string;
  quantity: number;
  user_id?: string;
}

export interface ConfirmReservationRequest {
  payment_reference: string;
}

export interface CreateProductRequest {
  sku: string;
  name: string;
  description?: string;
  initial_stock?: number;
}

export interface AdjustInventoryRequest {
  sku: string;
  adjustment: number;
  reason: string;
}

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface ApiSuccessResponse<T = unknown> {
  data: T;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ─── Durable Object Message Types ───────────────────────────────────

export type DOAction = 'reserve' | 'confirm' | 'cancel' | 'releaseExpired' | 'getSnapshot';
export type InventoryDOAction = DOAction | 'adjustStock';

export interface DORequest {
  action: InventoryDOAction;
  skuId?: string;
  quantity?: number;
  userId?: string;
  idempotencyKey?: string;
  reservationId?: string;
  paymentReference?: string;
  adjustment?: number;
  reason?: string;
}

export interface DOResponse {
  success: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ─── Error Codes ────────────────────────────────────────────────────

export const ErrorCodes = {
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  RESERVATION_EXPIRED: 'RESERVATION_EXPIRED',
  RESERVATION_NOT_FOUND: 'RESERVATION_NOT_FOUND',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  INVALID_REQUEST: 'INVALID_REQUEST',
  ALREADY_CONFIRMED: 'ALREADY_CONFIRMED',
  ALREADY_CANCELLED: 'ALREADY_CANCELLED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
