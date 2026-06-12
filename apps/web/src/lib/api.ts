import type {
  AdjustInventoryRequest,
  ApiErrorPayload,
  AuditLogEntry,
  ConfirmReservationRequest,
  CreateProductRequest,
  CreateReservationRequest,
  Order,
  PaginatedResponse,
  Product,
  Reservation,
} from './types';
import { generateIdempotencyKey } from './utils';

type JsonResponse<T> = { data: T };

function resolveApiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (window.location.port === '5173') {
    return '/api';
  }

  return `${window.location.origin.replace(/\/$/, '')}/api`;
}

export class ApiClient {
  private readonly baseUrl = resolveApiBase();

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      let payload: ApiErrorPayload | null = null;
      try {
        payload = (await response.json()) as ApiErrorPayload;
      } catch {
        payload = null;
      }

      throw new Error(payload?.error.message ?? `Request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  }

  async listProducts(): Promise<Product[]> {
    const response = await this.request<JsonResponse<Product[]>>('/products');
    return response.data;
  }

  async getProduct(sku: string): Promise<Product> {
    const response = await this.request<JsonResponse<Product>>(`/products/${encodeURIComponent(sku)}`);
    return response.data;
  }

  async createReservation(input: CreateReservationRequest): Promise<Reservation> {
    const response = await this.request<JsonResponse<Reservation>>('/reservations', {
      method: 'POST',
      headers: {
        'Idempotency-Key': generateIdempotencyKey(),
      },
      body: JSON.stringify(input),
    });

    return response.data;
  }

  async getReservation(id: string): Promise<Reservation> {
    const response = await this.request<JsonResponse<Reservation>>(`/reservations/${id}`);
    return response.data;
  }

  async confirmReservation(
    id: string,
    input: ConfirmReservationRequest,
  ): Promise<{ reservation: Reservation; order: Order }> {
    const response = await this.request<JsonResponse<{ reservation: Reservation; order: Order }>>(
      `/reservations/${id}/confirm`,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': generateIdempotencyKey(),
        },
        body: JSON.stringify(input),
      },
    );

    return response.data;
  }

  async cancelReservation(id: string): Promise<Reservation> {
    const response = await this.request<JsonResponse<Reservation>>(`/reservations/${id}/cancel`, {
      method: 'POST',
    });
    return response.data;
  }

  async createProduct(input: CreateProductRequest, apiKey: string): Promise<Product> {
    const response = await this.request<JsonResponse<Product>>('/admin/products', {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(input),
    });

    return response.data;
  }

  async adjustInventory(
    input: AdjustInventoryRequest,
    apiKey: string,
  ): Promise<{ inventory: Product; previous_stock: number; new_stock: number }> {
    const response = await this.request<
      JsonResponse<{ inventory: Product; previous_stock: number; new_stock: number }>
    >('/admin/inventory/adjust', {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(input),
    });

    return response.data;
  }

  async listReservations(apiKey: string): Promise<PaginatedResponse<Reservation>> {
    return this.request<PaginatedResponse<Reservation>>('/admin/reservations', {
      headers: { 'X-API-Key': apiKey },
    });
  }

  async listOrders(apiKey: string): Promise<PaginatedResponse<Order>> {
    return this.request<PaginatedResponse<Order>>('/admin/orders', {
      headers: { 'X-API-Key': apiKey },
    });
  }

  async listAuditLog(apiKey: string): Promise<PaginatedResponse<AuditLogEntry>> {
    return this.request<PaginatedResponse<AuditLogEntry>>('/admin/audit-log', {
      headers: { 'X-API-Key': apiKey },
    });
  }
}

export const api = new ApiClient();
