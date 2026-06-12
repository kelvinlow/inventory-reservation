# Architecture Overview

## System Architecture

The inventory reservation system is built on Cloudflare's edge platform, leveraging three key primitives for a fully serverless, globally distributed deployment.

## Component Overview

### Cloudflare Pages (Frontend)
- **Technology**: React + Vite, deployed as static assets
- **Purpose**: Customer-facing product browsing and reservation flow, plus admin dashboard
- **Deployment**: Automatic via Cloudflare Pages CI/CD with preview deployments per branch

### Cloudflare Worker (API)
- **Technology**: TypeScript + Hono framework
- **Purpose**: REST API gateway handling routing, validation, orchestration, and error handling
- **Key responsibilities**:
  - Request validation using Zod schemas
  - Idempotency key management
  - Routing inventory operations to the correct Durable Object
  - CORS and rate limiting
  - Scheduled cron triggers for expired reservation sweeps

### Durable Objects (Concurrency Engine)
- **Namespace**: `InventoryReservationDO`
- **Instance naming**: One instance per SKU (named by product ID)
- **Purpose**: Serialize all inventory-mutating operations for a given SKU

#### Why Durable Objects?

The core technical challenge is preventing overselling when multiple users compete for limited stock simultaneously. Consider a flash sale where 1,000 users hit "Reserve" within the same second for a product with only 10 units.

**Without serialization (D1 alone)**:
```
Time T0: User A reads available_stock = 1
Time T0: User B reads available_stock = 1
Time T1: User A writes reservation → reserved_count = 1 → available = 0
Time T1: User B writes reservation → reserved_count = 2 → available = -1  ← OVERSOLD
```

**With Durable Object serialization**:
```
Time T0: User A's request enters DO → reads available_stock = 1 → reserves → available = 0
Time T1: User B's request enters DO → reads available_stock = 0 → REJECTED
```

Each Durable Object instance:
1. Processes one request at a time (single-threaded per instance)
2. Maintains an in-memory cache of inventory state
3. Syncs to D1 for durability
4. Expires stale reservations before each mutation

### Cloudflare D1 (Persistence)
- **Technology**: SQLite-based serverless database
- **Purpose**: Durable storage for products, inventory counts, reservations, orders, and audit trails
- **Schema**: 5 tables with foreign key constraints and check constraints

## Data Flow

### Reserve Flow
```
Client → Worker → Durable Object (SKU) → D1
  1. POST /api/reservations { sku, quantity }
  2. Worker validates request with Zod
  3. Worker looks up product SKU → product ID
  4. Worker routes to InventoryReservationDO(product.id)
  5. DO sweeps expired reservations for this SKU
  6. DO checks: available_stock >= requested_quantity
  7. DO creates reservation in D1, increments reserved_count
  8. DO writes audit log entry
  9. Response: { reservationId, expiresAt, status }
```

### Confirm Flow
```
Client → Worker → Durable Object (SKU) → D1
  1. POST /api/reservations/:id/confirm
  2. Worker fetches reservation → gets SKU
  3. Worker routes to InventoryReservationDO(reservation.skuId)
  4. DO validates: reservation exists, status=reserved, not expired
  5. DO updates reservation status to confirmed
  6. DO decrements reserved_count, increments confirmed_count
  7. DO creates order record
  8. DO writes audit log entry
  9. Response: { orderId, status }
```

### Expiry Flow
```
Two mechanisms:

1. Lazy cleanup:
   - Before any mutation, DO sweeps expired reservations
   - Changes status to 'expired', decrements reserved_count
   
2. Scheduled sweep (cron every 5 minutes):
   - Worker queries D1 for all expired reservations
   - Routes each to its SKU's Durable Object for cleanup
   - Safety net for SKUs with no recent activity
```

## Consistency Model

| Operation | Consistency | Mechanism |
|-----------|-------------|-----------|
| Reserve | Strong | DO serialization |
| Confirm | Strong | DO serialization |
| Cancel | Strong | DO serialization |
| Expiry | Eventual | Lazy + cron sweep |
| Product listing | Eventual | Direct D1 read |
| Stock display | Eventual | Direct D1 read |

## Security Model

| Layer | Control |
|-------|---------|
| Input validation | Zod schemas on all mutation endpoints |
| Idempotency | Required header on POST mutations |
| Admin auth | API key validation on admin endpoints |
| Rate limiting | Per-IP sliding window on reservation creation |
| Audit trail | All inventory changes logged with actor info |
| Internal endpoints | Protected by shared secret |

## Inventory Arithmetic

```
total_stock      = base stock level (set by admin)
reserved_count   = number of units in active reservations
confirmed_count  = number of units in confirmed orders
available_stock  = total_stock - reserved_count - confirmed_count

Invariants:
  - reserved_count >= 0
  - confirmed_count >= 0
  - available_stock >= 0 (enforced before reservation)
  - reserved_count + confirmed_count <= total_stock
```
