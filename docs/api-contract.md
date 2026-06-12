# API Contract

Base URL: `https://<worker-domain>` or `http://localhost:8787` for local development.

All responses use JSON content type. All timestamps are ISO 8601 UTC strings.

---

## Public Endpoints

### GET /api/products

List all active products with current stock availability.

**Response 200**
```json
{
  "products": [
    {
      "id": "prod_abc123",
      "sku": "SKU-FLASH-001",
      "name": "Flash Sale Sneakers",
      "description": "Limited edition sneakers",
      "status": "active",
      "availableStock": 45,
      "totalStock": 50,
      "reservedCount": 3,
      "confirmedCount": 2
    }
  ]
}
```

---

### GET /api/products/:sku

Get a single product by SKU with full stock details.

**Response 200**
```json
{
  "product": {
    "id": "prod_abc123",
    "sku": "SKU-FLASH-001",
    "name": "Flash Sale Sneakers",
    "description": "Limited edition sneakers",
    "status": "active",
    "availableStock": 45,
    "totalStock": 50,
    "reservedCount": 3,
    "confirmedCount": 2,
    "createdAt": "2026-06-01T00:00:00Z",
    "updatedAt": "2026-06-12T10:00:00Z"
  }
}
```

**Response 404**
```json
{
  "error": {
    "code": "PRODUCT_NOT_FOUND",
    "message": "Product with SKU 'SKU-INVALID' not found"
  }
}
```

---

### POST /api/reservations

Create a new inventory reservation.

**Headers**
| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |
| `Idempotency-Key` | Yes | UUID for deduplication |

**Request Body**
```json
{
  "sku": "SKU-FLASH-001",
  "quantity": 1
}
```

| Field | Type | Constraints |
|-------|------|-------------|
| `sku` | string | Must be an active product SKU |
| `quantity` | integer | Must be >= 1 |

**Response 201**
```json
{
  "reservationId": "res_xyz789",
  "sku": "SKU-FLASH-001",
  "quantity": 1,
  "status": "reserved",
  "expiresAt": "2026-06-12T12:30:00Z",
  "createdAt": "2026-06-12T12:15:00Z"
}
```

**Response 409 - Insufficient Stock**
```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Not enough stock available",
    "details": {
      "available": 0,
      "requested": 1
    }
  }
}
```

**Response 409 - Idempotency Hit**

Returns the original reservation if the same idempotency key is reused:
```json
{
  "reservationId": "res_xyz789",
  "sku": "SKU-FLASH-001",
  "quantity": 1,
  "status": "reserved",
  "expiresAt": "2026-06-12T12:30:00Z",
  "createdAt": "2026-06-12T12:15:00Z",
  "idempotent": true
}
```

---

### GET /api/reservations/:id

Get reservation details by ID.

**Response 200**
```json
{
  "reservation": {
    "id": "res_xyz789",
    "skuId": "prod_abc123",
    "sku": "SKU-FLASH-001",
    "productName": "Flash Sale Sneakers",
    "quantity": 1,
    "status": "reserved",
    "expiresAt": "2026-06-12T12:30:00Z",
    "createdAt": "2026-06-12T12:15:00Z",
    "updatedAt": "2026-06-12T12:15:00Z"
  }
}
```

**Response 404**
```json
{
  "error": {
    "code": "RESERVATION_NOT_FOUND",
    "message": "Reservation 'res_invalid' not found"
  }
}
```

---

### POST /api/reservations/:id/confirm

Confirm a reservation, converting it to an order.

**Headers**
| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |

**Request Body**
```json
{
  "paymentReference": "mock-pay-001"
}
```

| Field | Type | Constraints |
|-------|------|-------------|
| `paymentReference` | string | Optional, for tracking |

**Response 200**
```json
{
  "orderId": "ord_def456",
  "reservationId": "res_xyz789",
  "status": "completed",
  "paymentReference": "mock-pay-001",
  "createdAt": "2026-06-12T12:20:00Z"
}
```

**Response 409 - Expired**
```json
{
  "error": {
    "code": "RESERVATION_EXPIRED",
    "message": "Reservation has expired and stock has been released"
  }
}
```

**Response 409 - Already Confirmed**
```json
{
  "error": {
    "code": "ALREADY_CONFIRMED",
    "message": "Reservation has already been confirmed"
  }
}
```

---

### POST /api/reservations/:id/cancel

Cancel an active reservation.

**Response 200**
```json
{
  "reservationId": "res_xyz789",
  "status": "cancelled"
}
```

**Response 409 - Already Confirmed**
```json
{
  "error": {
    "code": "ALREADY_CONFIRMED",
    "message": "Cannot cancel a confirmed reservation"
  }
}
```

---

## Admin Endpoints

All admin endpoints require the `X-Admin-Key` header matching the configured admin secret.

### POST /api/admin/products

Create or update a product.

**Request Body**
```json
{
  "sku": "SKU-NEW-001",
  "name": "New Product",
  "description": "Product description",
  "initialStock": 100
}
```

**Response 201**
```json
{
  "product": {
    "id": "prod_new001",
    "sku": "SKU-NEW-001",
    "name": "New Product",
    "status": "active"
  }
}
```

---

### POST /api/admin/inventory/adjust

Adjust inventory levels for a product.

**Request Body**
```json
{
  "sku": "SKU-FLASH-001",
  "delta": 100,
  "reason": "initial stock load"
}
```

| Field | Type | Constraints |
|-------|------|-------------|
| `sku` | string | Must exist |
| `delta` | integer | Positive or negative |
| `reason` | string | Required for audit trail |

**Response 200**
```json
{
  "sku": "SKU-FLASH-001",
  "previousStock": 50,
  "newStock": 150,
  "delta": 100,
  "reason": "initial stock load"
}
```

---

### GET /api/admin/reservations

List reservations with optional filters.

**Query Parameters**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status |
| `sku` | string | Filter by SKU |
| `limit` | integer | Max results (default 50) |
| `offset` | integer | Pagination offset |

**Response 200**
```json
{
  "reservations": [...],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

---

### GET /api/admin/orders

List orders with optional filters.

**Query Parameters**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status |
| `limit` | integer | Max results (default 50) |
| `offset` | integer | Pagination offset |

**Response 200**
```json
{
  "orders": [...],
  "total": 25,
  "limit": 50,
  "offset": 0
}
```

---

### GET /api/admin/audit-log

View the audit trail.

**Query Parameters**
| Parameter | Type | Description |
|-----------|------|-------------|
| `entityType` | string | Filter by entity type |
| `entityId` | string | Filter by entity ID |
| `action` | string | Filter by action |
| `limit` | integer | Max results (default 50) |
| `offset` | integer | Pagination offset |

**Response 200**
```json
{
  "entries": [
    {
      "id": "aud_001",
      "entityType": "inventory",
      "entityId": "prod_abc123",
      "action": "stock_adjusted",
      "actorType": "admin",
      "actorId": "admin",
      "payload": {
        "delta": 100,
        "reason": "initial stock load",
        "previousStock": 50,
        "newStock": 150
      },
      "createdAt": "2026-06-12T10:00:00Z"
    }
  ],
  "total": 200,
  "limit": 50,
  "offset": 0
}
```

---

## Internal Endpoints

### POST /api/internal/reservations/expire

Trigger manual expiry sweep. Protected by `X-Internal-Secret` header.

**Response 200**
```json
{
  "expiredCount": 5,
  "processedAt": "2026-06-12T12:00:00Z"
}
```

---

### GET /api/health

Health check endpoint.

**Response 200**
```json
{
  "status": "healthy",
  "timestamp": "2026-06-12T12:00:00Z"
}
```

---

## Error Response Format

All errors follow a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_REQUEST` | 400 | Request validation failed |
| `PRODUCT_NOT_FOUND` | 404 | Product SKU doesn't exist |
| `RESERVATION_NOT_FOUND` | 404 | Reservation ID doesn't exist |
| `INSUFFICIENT_STOCK` | 409 | Not enough available stock |
| `RESERVATION_EXPIRED` | 409 | Reservation has expired |
| `ALREADY_CONFIRMED` | 409 | Reservation already confirmed |
| `ALREADY_CANCELLED` | 409 | Reservation already cancelled |
| `IDEMPOTENCY_CONFLICT` | 409 | Idempotency key reused with different params |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
