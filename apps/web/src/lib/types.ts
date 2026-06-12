export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  status: 'active' | 'inactive' | 'archived';
  total_stock: number;
  reserved_count: number;
  confirmed_count: number;
  available_stock: number;
}

export interface Reservation {
  id: string;
  sku_id: string;
  user_id: string | null;
  quantity: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  expires_at: string;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  reservation_id: string;
  status: 'completed' | 'refunded';
  payment_reference: string | null;
  confirmation_idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_type: string;
  actor_id: string | null;
  payload_json: string;
  created_at: string;
}

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

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'accent';
