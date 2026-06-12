# Inventory Reservation System

A concurrency-safe inventory reservation system built on Cloudflare's edge platform. It prevents overselling during high-demand sale events by routing each SKU through a Durable Object and persisting state in D1.

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌────────────────┐
│  Cloudflare      │────▶│  Cloudflare Worker    │────▶│  Durable       │
│  Pages (Vite UI) │     │  (Hono REST API)      │     │  Objects       │
│                  │◀────│                       │◀────│  (per SKU)     │
└─────────────────┘     └──────────┬───────────┘     └────────┬───────┘
                                   │                          │
                                   ▼                          ▼
                            ┌──────────────┐          ┌──────────────┐
                            │  Cloudflare   │          │  Cloudflare   │
                            │  D1 (SQLite)  │◀─────────│  D1 (SQLite)  │
                            └──────────────┘          └──────────────┘
```

### Why Durable Objects?

In a flash sale scenario, hundreds of users may attempt to reserve the last few units simultaneously. Without serialization, race conditions can lead to overselling:

1. User A reads: 1 unit available → reserves it
2. User B reads: 1 unit available → also reserves it  
3. **Result: 2 reservations for 1 unit = OVERSOLD**

Durable Objects solve this by routing all inventory operations for a given SKU to a single instance. Operations are serialized, ensuring:
- Only one reservation attempt processes at a time per SKU
- Stock counts are always consistent
- The "last unit" contention is handled safely

### Guarantees

| Guarantee | Strength |
|-----------|----------|
| No overselling | **Strong** - enforced by DO serialization |
| Reservation expiry | **Eventual** - lazy cleanup + scheduled sweep |
| Idempotency | **Strong** - keyed on unique idempotency key |
| Audit completeness | **Strong** - all mutations logged synchronously |

## Project Structure

```
inventory-reservation/
├── apps/web/          # Vite frontend (Cloudflare Pages)
├── workers/api/       # Cloudflare Worker API
│   ├── src/
│   │   ├── durable-objects/  # SKU inventory Durable Object
│   │   ├── routes/           # Hono route handlers
│   │   ├── services/         # Business logic
│   │   ├── repositories/     # D1 data access
│   │   └── validators/       # Zod request schemas
│   ├── migrations/           # D1 SQL migrations
│   └── test/                 # Vitest tests
├── docs/                     # Documentation
└── package.json              # Monorepo root
```

## Getting Started

### Prerequisites

- Node.js 22+
- npm 10+
- Wrangler CLI (`npm install -g wrangler`)

### Local Development

```bash
# Install dependencies
npm install

# Create D1 database in Cloudflare once, then copy the generated
# database_id into workers/api/wrangler.jsonc
npx wrangler d1 create inventory-reservation-db

# Run local migrations
npm run db:migrate:local

# Seed sample products
npm run seed --workspace=workers/api

# Start the Worker API (port 8787)
npm run dev:api

# In a separate terminal, start the frontend (port 5173)
npm run dev:web
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- --run test/concurrency.test.ts
```

## API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/products` | List active products with stock |
| `GET` | `/api/products/:sku` | Product detail with availability |
| `POST` | `/api/reservations` | Create a reservation |
| `GET` | `/api/reservations/:id` | Get reservation status |
| `POST` | `/api/reservations/:id/confirm` | Confirm reservation |
| `POST` | `/api/reservations/:id/cancel` | Cancel reservation |

### Admin

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/products` | Create/update product |
| `POST` | `/api/admin/inventory/adjust` | Adjust stock levels |
| `GET` | `/api/admin/reservations` | List reservations |
| `GET` | `/api/admin/orders` | List orders |
| `GET` | `/api/admin/audit-log` | View audit trail |

### Creating a Reservation

```bash
curl -X POST http://localhost:8787/api/reservations \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"sku": "SKU-FLASH-001", "quantity": 1}'
```

Response:
```json
{
  "reservationId": "res_abc123",
  "sku": "SKU-FLASH-001",
  "quantity": 1,
  "status": "pending",
  "expiresAt": "2026-06-12T12:30:00Z"
}
```

Confirm requests also require an `Idempotency-Key` header. Admin and internal endpoints require `X-API-Key` or `Authorization: Bearer <key>`.

The frontend defaults to `/api` in local development, so Vite proxies browser requests to the Worker on port `8787`. To point Pages at a deployed Worker, set `VITE_API_BASE_URL` before building `apps/web`.

## Reservation Lifecycle

```
    ┌──────────┐
    │ pending  │
    └────┬─────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌─────────┐ ┌───────────┐
│confirmed│ │ expired │ │ cancelled │
└─────────┘ └─────────┘ └───────────┘
```

- **Pending** → stock is held for 15 minutes
- **Confirmed** → reservation converted to order
- **Expired** → hold released (lazy + scheduled sweep)
- **Cancelled** → hold released immediately

## Deployment

### Deploy Worker API

```bash
cd workers/api

# Create D1 database
npx wrangler d1 create inventory-reservation-db

# Run migrations on remote
npx wrangler d1 migrations apply inventory-reservation-db --remote

# Deploy worker
npx wrangler deploy
```

### Deploy Frontend

```bash
cd apps/web
VITE_API_BASE_URL="https://inventory-reservation-api.<subdomain>.workers.dev/api" npm run build
npx wrangler pages deploy dist --project-name inventory-reservation
```

## Concurrency Safety Proof

The test suite includes a concurrency test that:
1. Creates a product with 10 units of stock
2. Fires 100 simultaneous reservation requests
3. Asserts exactly 10 succeed
4. Asserts 90 fail with `INSUFFICIENT_STOCK`
5. Asserts final inventory counts are consistent (no negative stock)

## Future Enhancements

- Payment gateway integration (Stripe)
- WebSocket/SSE for real-time stock updates
- Per-user reservation limits
- Multi-warehouse inventory routing
- Advanced RBAC with JWT authentication
- Analytics dashboard with reservation metrics
- Queue-based async notifications
- Inventory partitioning by region

## License

MIT
