import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
  SELF,
} from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '../src/types/env.js';

const testEnv = env as unknown as Env;

// Helper to run migrations and seed data
async function setupDatabase() {
  await testEnv.DB.batch([
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT \'active\', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)'),
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS inventory (sku_id TEXT PRIMARY KEY, total_stock INTEGER NOT NULL CHECK (total_stock >= 0), reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0), confirmed_count INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_count >= 0), version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, FOREIGN KEY (sku_id) REFERENCES products(id))'),
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, sku_id TEXT NOT NULL, user_id TEXT, quantity INTEGER NOT NULL CHECK (quantity > 0), status TEXT NOT NULL, expires_at TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (sku_id) REFERENCES products(id))'),
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, payment_reference TEXT, confirmation_idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (reservation_id) REFERENCES reservations(id))'),
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)'),
  ]);

  // Seed a test product
  const now = new Date().toISOString();
  await testEnv.DB.exec(`INSERT OR REPLACE INTO products (id, sku, name, description, status, created_at, updated_at) VALUES ('test-product-001', 'SKU-TEST-001', 'Test Product', 'A test product', 'active', '${now}', '${now}');`);
  await testEnv.DB.exec(`INSERT OR REPLACE INTO inventory (sku_id, total_stock, reserved_count, confirmed_count, version, updated_at) VALUES ('test-product-001', 50, 0, 0, 0, '${now}');`);
}

describe('Reservation State Transitions', () => {
  beforeEach(async () => {
    await setupDatabase();
    // Clear all tables
    await testEnv.DB.exec('DELETE FROM audit_log;');
    await testEnv.DB.exec('DELETE FROM orders;');
    await testEnv.DB.exec('DELETE FROM reservations;');
    await testEnv.DB.exec('DELETE FROM inventory;');
    await testEnv.DB.exec('DELETE FROM products;');

    const now = new Date().toISOString();
    await testEnv.DB.exec(`INSERT OR REPLACE INTO products (id, sku, name, description, status, created_at, updated_at) VALUES ('test-product-001', 'SKU-TEST-001', 'Test Product', 'A test product', 'active', '${now}', '${now}');`);
    await testEnv.DB.exec(`INSERT OR REPLACE INTO inventory (sku_id, total_stock, reserved_count, confirmed_count, version, updated_at) VALUES ('test-product-001', 50, 0, 0, 0, '${now}');`);
  });

  it('should create a reservation successfully', async () => {
    const response = await SELF.fetch('http://localhost/api/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'test-key-create-001',
      },
      body: JSON.stringify({
        sku: 'SKU-TEST-001',
        quantity: 2,
        user_id: 'user-001',
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as any;
    expect(body.data).toBeDefined();
    expect(body.data.status).toBe('pending');
    expect(body.data.quantity).toBe(2);
    expect(body.data.sku_id).toBe('test-product-001');
    expect(body.data.user_id).toBe('user-001');
    expect(body.data.expires_at).toBeDefined();
  });

  it('should return same reservation for idempotent request', async () => {
    const idempotencyKey = 'test-idempotent-001';

    const res1 = await SELF.fetch('http://localhost/api/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        sku: 'SKU-TEST-001',
        quantity: 1,
      }),
    });

    expect(res1.status).toBe(201);
    const body1 = await res1.json() as any;

    // Repeat with same idempotency key
    const res2 = await SELF.fetch('http://localhost/api/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        sku: 'SKU-TEST-001',
        quantity: 1,
      }),
    });

    expect(res2.status).toBe(201);
    const body2 = await res2.json() as any;
    expect(body2.data.id).toBe(body1.data.id);
  });

  it('should confirm a reservation and create order', async () => {
    // Create reservation
    const createRes = await SELF.fetch('http://localhost/api/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'test-confirm-001',
      },
      body: JSON.stringify({
        sku: 'SKU-TEST-001',
        quantity: 1,
      }),
    });

    const created = await createRes.json() as any;
    const reservationId = created.data.id;

    // Confirm
    const confirmRes = await SELF.fetch(
      `http://localhost/api/reservations/${reservationId}/confirm`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'test-confirm-call-001',
        },
        body: JSON.stringify({ payment_reference: 'PAY-12345' }),
      },
    );

    expect(confirmRes.status).toBe(200);
    const confirmed = await confirmRes.json() as any;
    expect(confirmed.data.reservation.status).toBe('confirmed');
    expect(confirmed.data.order).toBeDefined();
    expect(confirmed.data.order.payment_reference).toBe('PAY-12345');
    expect(confirmed.data.order.status).toBe('completed');
  });

  it('should cancel a pending reservation', async () => {
    // Create reservation
    const createRes = await SELF.fetch('http://localhost/api/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'test-cancel-001',
      },
      body: JSON.stringify({
        sku: 'SKU-TEST-001',
        quantity: 3,
      }),
    });

    const created = await createRes.json() as any;
    const reservationId = created.data.id;

    // Cancel
    const cancelRes = await SELF.fetch(
      `http://localhost/api/reservations/${reservationId}/cancel`,
      { method: 'POST' },
    );

    expect(cancelRes.status).toBe(200);
    const cancelled = await cancelRes.json() as any;
    expect(cancelled.data.status).toBe('cancelled');
  });

  it('should prevent confirming an already cancelled reservation', async () => {
    // Create and cancel
    const createRes = await SELF.fetch('http://localhost/api/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'test-cancel-confirm-001',
      },
      body: JSON.stringify({
        sku: 'SKU-TEST-001',
        quantity: 1,
      }),
    });

    const created = await createRes.json() as any;
    const reservationId = created.data.id;

    await SELF.fetch(
      `http://localhost/api/reservations/${reservationId}/cancel`,
      { method: 'POST' },
    );

    // Try to confirm after cancel
    const confirmRes = await SELF.fetch(
      `http://localhost/api/reservations/${reservationId}/confirm`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'test-cancel-confirm-002',
        },
        body: JSON.stringify({ payment_reference: 'PAY-99999' }),
      },
    );

    expect(confirmRes.status).toBe(409);
    const error = await confirmRes.json() as any;
    expect(error.error.code).toBe('ALREADY_CANCELLED');
  });

  it('should prevent double confirmation', async () => {
    // Create and confirm
    const createRes = await SELF.fetch('http://localhost/api/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'test-double-confirm-001',
      },
      body: JSON.stringify({
        sku: 'SKU-TEST-001',
        quantity: 1,
      }),
    });

    const created = await createRes.json() as any;
    const reservationId = created.data.id;

    await SELF.fetch(
      `http://localhost/api/reservations/${reservationId}/confirm`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'test-double-confirm-002',
        },
        body: JSON.stringify({ payment_reference: 'PAY-11111' }),
      },
    );

    // Retry with the same idempotency key; should return the prior success payload.
    const confirmRes = await SELF.fetch(
      `http://localhost/api/reservations/${reservationId}/confirm`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'test-double-confirm-002',
        },
        body: JSON.stringify({ payment_reference: 'PAY-22222' }),
      },
    );

    expect(confirmRes.status).toBe(200);
    const confirmed = await confirmRes.json() as any;
    expect(confirmed.data.reservation.status).toBe('confirmed');
    expect(confirmed.data.order.payment_reference).toBe('PAY-11111');
  });

  it('should reject confirm without Idempotency-Key header', async () => {
    const createRes = await SELF.fetch('http://localhost/api/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'test-confirm-missing-header-001',
      },
      body: JSON.stringify({
        sku: 'SKU-TEST-001',
        quantity: 1,
      }),
    });

    const created = await createRes.json() as any;
    const reservationId = created.data.id;

    const confirmRes = await SELF.fetch(
      `http://localhost/api/reservations/${reservationId}/confirm`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_reference: 'PAY-33333' }),
      },
    );

    expect(confirmRes.status).toBe(400);
    const error = await confirmRes.json() as any;
    expect(error.error.code).toBe('INVALID_REQUEST');
  });

  it('should require Idempotency-Key header', async () => {
    const response = await SELF.fetch('http://localhost/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: 'SKU-TEST-001',
        quantity: 1,
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json() as any;
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('should validate request body', async () => {
    const response = await SELF.fetch('http://localhost/api/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'test-validate-001',
      },
      body: JSON.stringify({
        sku: '',
        quantity: -1,
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json() as any;
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('should return 404 for non-existent reservation', async () => {
    const response = await SELF.fetch(
      'http://localhost/api/reservations/non-existent-id',
    );

    expect(response.status).toBe(404);
    const body = await response.json() as any;
    expect(body.error.code).toBe('RESERVATION_NOT_FOUND');
  });

  it('should return 404 for non-existent product SKU', async () => {
    const response = await SELF.fetch('http://localhost/api/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'test-no-product-001',
      },
      body: JSON.stringify({
        sku: 'NON-EXISTENT-SKU',
        quantity: 1,
      }),
    });

    expect(response.status).toBe(404);
    const body = await response.json() as any;
    expect(body.error.code).toBe('PRODUCT_NOT_FOUND');
  });
});
