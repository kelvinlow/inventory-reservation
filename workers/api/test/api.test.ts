import {
  env,
  SELF,
} from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '../src/types/env.js';

const testEnv = env as unknown as Env;

const adminHeaders = {
  'Content-Type': 'application/json',
  'X-API-Key': 'test-admin-key',
};

const internalHeaders = {
  'X-API-Key': 'test-internal-key',
};

// Helper to run migrations and seed data
async function setupDatabase() {
  await testEnv.DB.batch([
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT \'active\', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)'),
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS inventory (sku_id TEXT PRIMARY KEY, total_stock INTEGER NOT NULL CHECK (total_stock >= 0), reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0), confirmed_count INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_count >= 0), version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, FOREIGN KEY (sku_id) REFERENCES products(id))'),
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, sku_id TEXT NOT NULL, user_id TEXT, quantity INTEGER NOT NULL CHECK (quantity > 0), status TEXT NOT NULL, expires_at TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (sku_id) REFERENCES products(id))'),
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, payment_reference TEXT, confirmation_idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (reservation_id) REFERENCES reservations(id))'),
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)'),
  ]);
}

async function seedProducts() {
  const now = new Date().toISOString();
  await testEnv.DB.batch([
    testEnv.DB
      .prepare(
        'INSERT OR REPLACE INTO products (id, sku, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind('api-test-001', 'SKU-API-001', 'API Test Product', 'Product for API tests', 'active', now, now),
    testEnv.DB
      .prepare(
        'INSERT OR REPLACE INTO products (id, sku, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind('api-test-002', 'SKU-API-002', 'Inactive Product', 'This one is inactive', 'inactive', now, now),
    testEnv.DB
      .prepare(
        'INSERT OR REPLACE INTO inventory (sku_id, total_stock, reserved_count, confirmed_count, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind('api-test-001', 20, 0, 0, 0, now),
    testEnv.DB
      .prepare(
        'INSERT OR REPLACE INTO inventory (sku_id, total_stock, reserved_count, confirmed_count, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind('api-test-002', 10, 0, 0, 0, now),
  ]);
}

describe('API Integration Tests', () => {
  beforeEach(async () => {
    await setupDatabase();
    await testEnv.DB.exec('DELETE FROM audit_log;');
    await testEnv.DB.exec('DELETE FROM orders;');
    await testEnv.DB.exec('DELETE FROM reservations;');
    await testEnv.DB.exec('DELETE FROM inventory;');
    await testEnv.DB.exec('DELETE FROM products;');
    await seedProducts();
  });

  // ─── Health Check ─────────────────────────────────────────────

  describe('GET /api/health', () => {
    it('should return healthy status', async () => {
      const res = await SELF.fetch('http://localhost/api/health');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.status).toBe('healthy');
    });
  });

  // ─── Products ─────────────────────────────────────────────────

  describe('GET /api/products', () => {
    it('should list active products', async () => {
      const res = await SELF.fetch('http://localhost/api/products');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data).toBeInstanceOf(Array);
      // Only active products
      const activeProducts = body.data.filter((p: any) => p.status === 'active');
      expect(activeProducts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/products/:sku', () => {
    it('should return product detail with stock info', async () => {
      const res = await SELF.fetch('http://localhost/api/products/SKU-API-001');
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.sku).toBe('SKU-API-001');
      expect(body.data.total_stock).toBe(20);
      expect(body.data.available_stock).toBe(20);
    });

    it('should return 404 for non-existent product', async () => {
      const res = await SELF.fetch('http://localhost/api/products/NON-EXISTENT');
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error.code).toBe('PRODUCT_NOT_FOUND');
    });
  });

  // ─── Reservations ─────────────────────────────────────────────

  describe('POST /api/reservations', () => {
    it('should create reservation and deduct available stock', async () => {
      const res = await SELF.fetch('http://localhost/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'api-test-reserve-001',
        },
        body: JSON.stringify({
          sku: 'SKU-API-001',
          quantity: 5,
          user_id: 'user-api-001',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.data.quantity).toBe(5);
      expect(body.data.status).toBe('pending');

      // Check stock was reduced
      const stockRes = await SELF.fetch('http://localhost/api/products/SKU-API-001');
      const stock = await stockRes.json() as any;
      expect(stock.data.available_stock).toBe(15); // 20 - 5
    });
  });

  // ─── Full Workflow ────────────────────────────────────────────

  describe('Full reservation workflow', () => {
    it('should handle reserve → confirm → check order', async () => {
      // Step 1: Reserve
      const reserveRes = await SELF.fetch('http://localhost/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'workflow-001',
        },
        body: JSON.stringify({
          sku: 'SKU-API-001',
          quantity: 2,
          user_id: 'workflow-user',
        }),
      });
      expect(reserveRes.status).toBe(201);
      const reserved = await reserveRes.json() as any;
      const reservationId = reserved.data.id;

      // Step 2: Check reservation status
      const statusRes = await SELF.fetch(
        `http://localhost/api/reservations/${reservationId}`,
      );
      expect(statusRes.status).toBe(200);
      const status = await statusRes.json() as any;
      expect(status.data.status).toBe('pending');

      // Step 3: Confirm
      const confirmRes = await SELF.fetch(
        `http://localhost/api/reservations/${reservationId}/confirm`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': 'workflow-confirm-001',
          },
          body: JSON.stringify({ payment_reference: 'STRIPE-PI-001' }),
        },
      );
      expect(confirmRes.status).toBe(200);
      const confirmed = await confirmRes.json() as any;
      expect(confirmed.data.order.status).toBe('completed');

      // Step 4: Verify stock — reserved moved to confirmed
      const stockRes = await SELF.fetch('http://localhost/api/products/SKU-API-001');
      const stock = await stockRes.json() as any;
      expect(stock.data.confirmed_count).toBe(2);
      expect(stock.data.available_stock).toBe(18); // 20 - 2 confirmed
    });

    it('should handle reserve → cancel → stock restored', async () => {
      // Reserve
      const reserveRes = await SELF.fetch('http://localhost/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'workflow-cancel-001',
        },
        body: JSON.stringify({
          sku: 'SKU-API-001',
          quantity: 3,
        }),
      });
      const reserved = await reserveRes.json() as any;
      const reservationId = reserved.data.id;

      // Cancel
      const cancelRes = await SELF.fetch(
        `http://localhost/api/reservations/${reservationId}/cancel`,
        { method: 'POST' },
      );
      expect(cancelRes.status).toBe(200);

      // Verify stock restored
      const stockRes = await SELF.fetch('http://localhost/api/products/SKU-API-001');
      const stock = await stockRes.json() as any;
      expect(stock.data.available_stock).toBe(20); // Fully restored
    });
  });

  // ─── Admin Endpoints ──────────────────────────────────────────

  describe('Admin API', () => {
    it('POST /api/admin/products should create a product', async () => {
      const res = await SELF.fetch('http://localhost/api/admin/products', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          sku: 'SKU-NEW-001',
          name: 'Brand New Product',
          description: 'Created via admin API',
          initial_stock: 100,
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.data.sku).toBe('SKU-NEW-001');
      expect(body.data.total_stock).toBe(100);
      expect(body.data.available_stock).toBe(100);
    });

    it('POST /api/admin/inventory/adjust should adjust stock', async () => {
      const res = await SELF.fetch('http://localhost/api/admin/inventory/adjust', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          sku: 'SKU-API-001',
          adjustment: 10,
          reason: 'Restock from warehouse',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.previous_stock).toBe(20);
      expect(body.data.new_stock).toBe(30);
    });

    it('should keep reservation decisions consistent after a DO is already warm', async () => {
      const firstReserve = await SELF.fetch('http://localhost/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'warm-do-001',
        },
        body: JSON.stringify({
          sku: 'SKU-API-001',
          quantity: 1,
        }),
      });
      expect(firstReserve.status).toBe(201);

      const adjustRes = await SELF.fetch('http://localhost/api/admin/inventory/adjust', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          sku: 'SKU-API-001',
          adjustment: -19,
          reason: 'Simulate admin stock reduction after DO hydration',
        }),
      });
      expect(adjustRes.status).toBe(200);

      const secondReserve = await SELF.fetch('http://localhost/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'warm-do-002',
        },
        body: JSON.stringify({
          sku: 'SKU-API-001',
          quantity: 1,
        }),
      });
      expect(secondReserve.status).toBe(409);
      const body = await secondReserve.json() as any;
      expect(body.error.code).toBe('INSUFFICIENT_STOCK');
    });

    it('GET /api/admin/reservations should list reservations', async () => {
      // Create a reservation first
      await SELF.fetch('http://localhost/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'admin-list-001',
        },
        body: JSON.stringify({
          sku: 'SKU-API-001',
          quantity: 1,
        }),
      });

      const res = await SELF.fetch('http://localhost/api/admin/reservations', {
        headers: { 'X-API-Key': 'test-admin-key' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data).toBeInstanceOf(Array);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.total).toBeGreaterThanOrEqual(1);
    });
    it('should reject admin requests without API key', async () => {
      const res = await SELF.fetch('http://localhost/api/admin/reservations');
      expect(res.status).toBe(401);
      const body = await res.json() as any;
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  // ─── Internal Endpoints ───────────────────────────────────────

  describe('Internal API', () => {
    it('POST /api/internal/reservations/expire should run sweep', async () => {
      const res = await SELF.fetch(
        'http://localhost/api/internal/reservations/expire',
        { method: 'POST', headers: internalHeaders },
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.data.total_expired).toBeDefined();
    });

    it('should reject internal requests without API key', async () => {
      const res = await SELF.fetch(
        'http://localhost/api/internal/reservations/expire',
        { method: 'POST' },
      );
      expect(res.status).toBe(401);
    });
  });

  // ─── 404 Handling ─────────────────────────────────────────────

  describe('404 Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await SELF.fetch('http://localhost/api/unknown');
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  // ─── CORS ─────────────────────────────────────────────────────

  describe('CORS', () => {
    it('should include CORS headers', async () => {
      const res = await SELF.fetch('http://localhost/api/products', {
        headers: { Origin: 'http://localhost:3000' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('should handle preflight OPTIONS requests', async () => {
      const res = await SELF.fetch('http://localhost/api/reservations', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Idempotency-Key',
        },
      });
      expect(res.status).toBe(204);
    });
  });
});
