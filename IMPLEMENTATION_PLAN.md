# Inventory Reservation System Implementation Plan

## 1. Objective

Build an inventory reservation system that prevents overselling during high-concurrency sale events and runs fully on Cloudflare.

Primary goals:
- prevent overselling for each SKU
- support temporary reservations with expiry
- allow reservation confirmation and release
- expose a simple customer flow and basic admin operations
- be deployable on Cloudflare Pages and Workers

## 2. Recommended Cloudflare Architecture

### Frontend
- **Cloudflare Pages**
  - customer-facing product and reservation UI
  - admin dashboard UI
  - preview deployments for branches and pull requests

### Backend
- **Cloudflare Worker**
  - REST API for products, reservations, confirmations, cancellations, and admin operations
  - request validation, auth, idempotency, and orchestration

### Concurrency Control
- **Durable Objects**
  - one Durable Object per `skuId` or `saleId:skuId`
  - serialize reservation and release operations for a single inventory bucket
  - ensure "last unit" contention is handled safely

### Persistence
- **Cloudflare D1**
  - durable relational storage for products, inventory, reservations, orders, and audit trail

### Background/Async
- **Cron Triggers**
  - sweep expired reservations as a safety net
- **Cloudflare Queues** (optional but recommended)
  - async notifications
  - webhook retries
  - non-critical event processing

## 3. System Boundaries

### In scope for the challenge
- product inventory display
- reservation creation
- reservation expiry
- reservation confirmation
- reservation cancellation
- admin inventory adjustments
- auditability of inventory-changing operations
- concurrency-safe reservation logic

### Out of scope unless explicitly required
- full payment gateway integration
- multi-warehouse inventory routing
- advanced RBAC
- deep analytics pipeline
- marketplace or multi-merchant support

## 4. Core Domain Model

### Product
Represents a sellable SKU.

Fields:
- `id`
- `sku`
- `name`
- `description`
- `status`
- `created_at`
- `updated_at`

### Inventory
Represents stock counts for a SKU.

Fields:
- `sku_id`
- `total_stock`
- `reserved_count`
- `confirmed_count`
- `version`
- `updated_at`

Derived availability:
- `available_stock = total_stock - reserved_count - confirmed_count`

### Reservation
Represents a temporary hold on inventory.

Fields:
- `id`
- `sku_id`
- `user_id` nullable
- `quantity`
- `status`
- `expires_at`
- `idempotency_key`
- `created_at`
- `updated_at`

Statuses:
- `reserved`
- `confirmed`
- `expired`
- `cancelled`

### Order
Represents the finalized purchase or completion event.

Fields:
- `id`
- `reservation_id`
- `status`
- `payment_reference` nullable
- `created_at`
- `updated_at`

### Audit Log
Tracks all inventory-affecting operations.

Fields:
- `id`
- `entity_type`
- `entity_id`
- `action`
- `actor_type`
- `actor_id`
- `payload_json`
- `created_at`

## 5. Reservation Lifecycle

### Happy path
1. User requests reservation for SKU and quantity.
2. Worker routes request to the SKU Durable Object.
3. Durable Object checks and cleans expired holds for that SKU.
4. Durable Object validates available stock.
5. Reservation is written to D1 and `reserved_count` is incremented.
6. API returns `reservationId`, `expiresAt`, and `status`.
7. User confirms reservation before expiry.
8. Durable Object changes reservation to `confirmed`.
9. `reserved_count` decreases and `confirmed_count` increases.
10. Order record is created.

### Expiry path
1. Reservation reaches `expires_at` without confirmation.
2. Expiry is handled lazily on next access and by scheduled sweep.
3. Reservation becomes `expired`.
4. `reserved_count` decreases.

### Cancellation path
1. User or admin cancels active reservation.
2. Durable Object changes reservation to `cancelled`.
3. `reserved_count` decreases.

## 6. Why Durable Objects Are Required

For this system, the main technical risk is concurrent access to the same stock pool.

Without Durable Objects:
- simultaneous requests can both observe the same available quantity
- D1 alone becomes harder to reason about under contention
- the no-oversell guarantee is harder to prove in a coding challenge

With Durable Objects:
- one logical writer exists per SKU
- each SKU becomes a serialized critical section
- oversell prevention becomes straightforward and demonstrable

## 7. Proposed Repository Structure

```text
inventory-reservation/
  apps/
    web/
      src/
        pages/
        components/
        lib/
      public/
      package.json
  workers/
    api/
      src/
        index.ts
        routes/
        middleware/
        services/
        repositories/
        durable-objects/
        validators/
        types/
      migrations/
      test/
      wrangler.jsonc
      package.json
  docs/
    architecture.md
    api-contract.md
    runbook.md
  package.json
  README.md
```

## 8. Suggested Tech Stack

### Frontend
- React or Next.js static export if simple
- deploy via Cloudflare Pages
- basic UI only; correctness matters more than design depth for this challenge

### API Worker
- TypeScript
- Hono is a good fit for routing and middleware, but plain Worker APIs are also fine

### Validation
- Zod for request/response validation

### Testing
- Vitest
- integration tests against Worker logic
- concurrency tests around Durable Objects

## 9. D1 Schema Proposal

```sql
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE inventory (
  sku_id TEXT PRIMARY KEY,
  total_stock INTEGER NOT NULL CHECK (total_stock >= 0),
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  confirmed_count INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_count >= 0),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sku_id) REFERENCES products(id)
);

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  sku_id TEXT NOT NULL,
  user_id TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sku_id) REFERENCES products(id)
);

CREATE INDEX idx_reservations_sku_status_expires
ON reservations (sku_id, status, expires_at);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  payment_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id)
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## 10. Durable Object Responsibilities

Each SKU Durable Object should:
- hold a short-lived in-memory view of inventory state
- reconcile with D1 when needed
- clean expired reservations before new mutation logic
- create reservations
- confirm reservations
- cancel reservations
- enforce idempotency on repeated requests

Methods to implement:
- `reserve(request)`
- `confirm(request)`
- `cancel(request)`
- `releaseExpired(now)`
- `getSnapshot()`

Important rule:
- all inventory-changing operations for a SKU must go through the same Durable Object

## 11. API Contract

### Public endpoints

#### `GET /api/products`
Returns active products with availability summary.

#### `GET /api/products/:sku`
Returns product details and available stock.

#### `POST /api/reservations`
Create a reservation.

Request:
```json
{
  "sku": "SKU-001",
  "quantity": 1
}
```

Headers:
- `Idempotency-Key: <uuid>`

Response:
```json
{
  "reservationId": "res_123",
  "sku": "SKU-001",
  "quantity": 1,
  "status": "reserved",
  "expiresAt": "2026-06-12T12:30:00Z"
}
```

#### `GET /api/reservations/:id`
Fetch reservation state.

#### `POST /api/reservations/:id/confirm`
Confirm reservation before expiry.

Request:
```json
{
  "paymentReference": "mock-pay-001"
}
```

#### `POST /api/reservations/:id/cancel`
Cancel active reservation.

### Admin endpoints

#### `POST /api/admin/products`
Create or update product data.

#### `POST /api/admin/inventory/adjust`
Adjust inventory levels.

Request:
```json
{
  "sku": "SKU-001",
  "delta": 100,
  "reason": "initial stock load"
}
```

#### `GET /api/admin/reservations`
Search and filter reservation records.

#### `GET /api/admin/orders`
Search and filter orders.

### Operational endpoints

#### `POST /api/internal/reservations/expire`
Protected internal endpoint for expiry sweep.

#### `GET /api/health`
Basic health check.

## 12. Request Validation and Idempotency

### Validation rules
- `sku` must exist and be active
- `quantity` must be a positive integer
- reservation confirmation must only apply to active, unexpired reservations
- cancellation must not apply to already confirmed reservations

### Idempotency rules
- require `Idempotency-Key` for create and confirm endpoints
- if the same client retries with the same key, return the prior result
- store idempotency mapping in D1 with the reservation record

## 13. Frontend Plan on Pages

### Customer pages
- product listing
- product details page
- reserve button
- reservation detail page with countdown timer
- confirmation result page
- cancellation result page

### Admin pages
- login-protected dashboard
- inventory table
- product editor
- reservation viewer
- order viewer
- audit log viewer

### UX requirements
- countdown must use server-issued `expiresAt`
- expired reservations must visibly transition without ambiguity
- reservation failure must clearly state "out of stock" or "expired"

## 14. Security and Abuse Controls

### Baseline controls
- admin authentication
- rate limiting on reservation creation
- request body validation
- Turnstile if customer flow is public
- internal endpoints protected by secret or service authentication

### Things to mention in the submission
- abuse prevention is important during flash sales
- idempotency protects against network retries
- audit logging protects stock integrity and debugging

## 15. Observability Plan

### Logs
Log structured JSON for:
- reservation attempt
- reservation success
- reservation reject
- expiry sweep result
- confirmation success/failure
- inventory adjustment

Fields:
- `requestId`
- `sku`
- `reservationId`
- `idempotencyKey`
- `status`
- `latencyMs`

### Metrics to track
- reservation success rate
- stockout rejection count
- expiry rate
- confirm conversion rate
- DO processing latency
- D1 query latency

## 16. Testing Strategy

### Unit tests
- reservation state transitions
- stock arithmetic
- expiry logic
- idempotency logic

### Integration tests
- reserve successfully when stock exists
- reject reservation when stock is exhausted
- confirm valid reservation
- reject confirm for expired reservation
- cancel valid reservation

### Concurrency tests
The most important test suite.

Required scenario:
- 100 concurrent reservation attempts for a SKU with stock `10`
- system must end with:
  - at most `10` successful reservations
  - zero negative stock
  - zero confirmed oversell

### Admin tests
- inventory adjustment updates totals correctly
- every adjustment creates an audit log record

## 17. Delivery Phases

### Phase 1: Project bootstrap
- initialize Pages app
- initialize Worker API
- create Wrangler config
- bind D1 and Durable Objects
- set up local development

Deliverables:
- bootstrapped repo
- local dev scripts
- base deployment configs

### Phase 2: Data layer
- create D1 schema and migrations
- implement repositories for products, inventory, reservations, orders, audit logs

Deliverables:
- migration files
- repository tests

### Phase 3: Concurrency-safe reservation engine
- build SKU Durable Object
- implement reserve, confirm, cancel, and expiry logic
- add idempotency support

Deliverables:
- working reservation engine
- concurrency tests

### Phase 4: Public API
- implement product and reservation routes
- add validation and error handling
- add health checks

Deliverables:
- API contract implemented
- integration tests

### Phase 5: Frontend
- build product list and product detail pages
- build reservation countdown flow
- integrate with Worker API

Deliverables:
- usable customer flow

### Phase 6: Admin
- build admin inventory view
- build adjustment form
- build reservation and order lists

Deliverables:
- usable admin flow

### Phase 7: Operations and hardening
- add cron-based expiry sweep
- add rate limiting
- add structured logs
- add documentation

Deliverables:
- production-readiness checklist
- deployment runbook

## 18. Suggested Timeline

### Day 1
- scaffold repo
- configure Cloudflare resources
- define schema and migrations

### Day 2
- implement Durable Object reservation flow
- implement public reservation APIs

### Day 3
- build frontend customer flow
- build admin inventory adjustment flow

### Day 4
- add tests, expiry sweep, logging, and deployment polish

If time is limited, prioritize:
1. Durable Object correctness
2. reservation lifecycle
3. concurrency tests
4. minimal UI

## 19. Acceptance Criteria

The submission should be considered complete when:
- concurrent reservation attempts never oversell stock
- reservations expire and release stock
- confirmation transitions reservations to completed orders
- inventory adjustments are auditable
- the app deploys on Cloudflare Pages and Workers
- there is a clear test proving contention safety

## 20. Biggest Risks and Mitigations

### Risk: overselling under concurrency
Mitigation:
- all stock mutations routed through one Durable Object per SKU

### Risk: stale reservations not released
Mitigation:
- lazy cleanup on access plus scheduled sweep

### Risk: duplicate client retries
Mitigation:
- idempotency keys on mutation endpoints

### Risk: challenge scope expanding too far
Mitigation:
- focus first on correctness and reservation lifecycle, not broad feature surface

## 21. Recommended First Build Order

Build these in order:
1. D1 schema and migrations
2. Durable Object reservation engine
3. `POST /api/reservations`
4. `POST /api/reservations/:id/confirm`
5. `POST /api/reservations/:id/cancel`
6. expiry sweep
7. product listing APIs
8. customer UI
9. admin UI
10. hardening and documentation

## 22. Submission Notes

In the final README or presentation, explicitly state:
- why Durable Objects were chosen
- how overselling is prevented
- what guarantees are strong versus eventual
- what would be added next with more time

Good "future work" items:
- payment provider integration
- stronger auth and RBAC
- per-user reservation limits
- WebSocket or SSE availability updates
- inventory partitioning by warehouse or region
