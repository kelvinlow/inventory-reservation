# Deployment Runbook

## Prerequisites

- Node.js 22+
- npm 10+
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account with Workers Paid plan (for Durable Objects)
- Authenticated via `wrangler login`

## Initial Deployment

### 1. Create D1 Database

```bash
npx wrangler d1 create inventory-reservation-db
```

Note the database ID from the output. Update `workers/api/wrangler.jsonc` with the actual database ID:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "inventory-reservation-db",
      "database_id": "<YOUR_DATABASE_ID>"
    }
  ]
}
```

### 2. Run Migrations

```bash
cd workers/api
npx wrangler d1 migrations apply inventory-reservation-db --remote
```

### 3. Set Secrets

```bash
# Admin API key for admin endpoints
npx wrangler secret put ADMIN_API_KEY

# Internal key for operational endpoints
npx wrangler secret put INTERNAL_API_KEY
```

### 4. Deploy Worker

```bash
cd workers/api
npx wrangler deploy
```

Note the deployed URL (e.g., `https://inventory-reservation-api.<subdomain>.workers.dev`).

### 5. Verify Health

```bash
curl https://inventory-reservation-api.<subdomain>.workers.dev/api/health
```

### 6. Seed Products

```bash
# Create products via admin API
curl -X POST https://inventory-reservation-api.<subdomain>.workers.dev/api/admin/products \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <YOUR_ADMIN_KEY>" \
  -d '{"sku": "SKU-FLASH-001", "name": "Flash Sale Sneakers", "description": "Limited edition sneakers", "initial_stock": 50}'
```

### 7. Deploy Frontend

```bash
cd apps/web

# Update API URL in environment
echo "VITE_API_BASE_URL=https://inventory-reservation-api.<subdomain>.workers.dev/api" > .env.production

# Build
npm run build

# Deploy to Pages
npx wrangler pages deploy dist --project-name=inventory-reservation
```

## Updating

### Deploy Worker Changes

```bash
cd workers/api
npx wrangler deploy
```

### Run New Migrations

```bash
cd workers/api
npx wrangler d1 migrations apply inventory-reservation-db --remote
```

### Deploy Frontend Changes

```bash
cd apps/web
npm run build
npx wrangler pages deploy dist --project-name=inventory-reservation
```

## Monitoring

### View Worker Logs

```bash
npx wrangler tail inventory-reservation-api
```

### Query D1 Directly

```bash
# Check inventory levels
npx wrangler d1 execute inventory-reservation-db --remote \
  --command "SELECT p.sku, p.name, i.total_stock, i.reserved_count, i.confirmed_count FROM products p JOIN inventory i ON p.id = i.sku_id"

# Check active reservations
npx wrangler d1 execute inventory-reservation-db --remote \
  --command "SELECT * FROM reservations WHERE status = 'reserved' ORDER BY expires_at"

# Check for overselling
npx wrangler d1 execute inventory-reservation-db --remote \
  --command "SELECT p.sku, i.total_stock, i.reserved_count, i.confirmed_count, (i.total_stock - i.reserved_count - i.confirmed_count) as available FROM products p JOIN inventory i ON p.id = i.sku_id WHERE (i.total_stock - i.reserved_count - i.confirmed_count) < 0"
```

## Troubleshooting

### Stale Reservations Not Expiring

1. Check if the cron trigger is running:
   ```bash
   npx wrangler tail inventory-reservation-api --format json | grep "scheduled"
   ```

2. Manually trigger expiry sweep:
   ```bash
   curl -X POST https://inventory-reservation-api.<subdomain>.workers.dev/api/internal/reservations/expire \
     -H "X-API-Key: <YOUR_INTERNAL_API_KEY>"
   ```

### Inventory Counts Look Wrong

1. Check audit log for unexpected operations:
   ```bash
   npx wrangler d1 execute inventory-reservation-db --remote \
     --command "SELECT * FROM audit_log WHERE entity_type = 'inventory' ORDER BY created_at DESC LIMIT 20"
   ```

2. Reconcile counts by checking actual reservations:
   ```bash
   npx wrangler d1 execute inventory-reservation-db --remote \
     --command "SELECT sku_id, status, COUNT(*) as count, SUM(quantity) as total_qty FROM reservations GROUP BY sku_id, status"
   ```

### Durable Object Errors

1. Check if DO is responding:
   ```bash
   curl https://inventory-reservation-api.<subdomain>.workers.dev/api/products/SKU-FLASH-001
   ```

2. DOs are automatically restarted by Cloudflare if they crash. The next request will trigger a fresh load from D1.

## Rollback

### Worker Rollback

```bash
# List deployments
npx wrangler deployments list

# Rollback to previous version
npx wrangler rollback
```

### D1 Rollback

D1 does not support automatic rollback. Create a reverse migration SQL file and apply it:

```bash
npx wrangler d1 execute inventory-reservation-db --remote --file=./migrations/rollback.sql
```
