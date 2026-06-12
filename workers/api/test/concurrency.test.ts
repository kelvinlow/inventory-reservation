import {
  env,
  SELF,
} from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Env } from '../src/types/env.js';

const testEnv = env as unknown as Env;

// Helper to run migrations
async function setupDatabase() {
  await testEnv.DB.batch([
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT \'active\', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)'),
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS inventory (sku_id TEXT PRIMARY KEY, total_stock INTEGER NOT NULL CHECK (total_stock >= 0), reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0), confirmed_count INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_count >= 0), version INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, FOREIGN KEY (sku_id) REFERENCES products(id))'),
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, sku_id TEXT NOT NULL, user_id TEXT, quantity INTEGER NOT NULL CHECK (quantity > 0), status TEXT NOT NULL, expires_at TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (sku_id) REFERENCES products(id))'),
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, payment_reference TEXT, confirmation_idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (reservation_id) REFERENCES reservations(id))'),
    testEnv.DB.prepare('CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)'),
  ]);
}

describe('Concurrency Safety Tests', () => {
  beforeEach(async () => {
    await setupDatabase();
    await testEnv.DB.exec('DELETE FROM audit_log;');
    await testEnv.DB.exec('DELETE FROM orders;');
    await testEnv.DB.exec('DELETE FROM reservations;');
    await testEnv.DB.exec('DELETE FROM inventory;');
    await testEnv.DB.exec('DELETE FROM products;');

    // Create product with exactly 10 units of stock
    const now = new Date().toISOString();
    await testEnv.DB.batch([
      testEnv.DB
        .prepare(
          'INSERT INTO products (id, sku, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind('concurrency-product', 'SKU-CONCURRENCY', 'Concurrency Test Product', 'Limited stock', 'active', now, now),
      testEnv.DB
        .prepare(
          'INSERT INTO inventory (sku_id, total_stock, reserved_count, confirmed_count, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind('concurrency-product', 10, 0, 0, 0, now),
    ]);
  });

  it('should handle 100 simultaneous requests with only 10 stock — exactly 10 succeed', async () => {
    const NUM_REQUESTS = 100;
    const STOCK = 10;

    // Fire 100 simultaneous reservation requests, each for 1 unit
    const promises = Array.from({ length: NUM_REQUESTS }, (_, i) =>
      SELF.fetch('http://localhost/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `concurrency-test-${i}`,
          'CF-Connecting-IP': `198.51.100.${i}`,
        },
        body: JSON.stringify({
          sku: 'SKU-CONCURRENCY',
          quantity: 1,
          user_id: `user-${i}`,
        }),
      }),
    );

    const responses = await Promise.all(promises);

    // Parse all responses
    const results = await Promise.all(
      responses.map(async (r) => ({
        status: r.status,
        body: await r.json() as any,
      })),
    );

    // Count successes (201) and failures
    const successes = results.filter((r) => r.status === 201);
    const stockErrors = results.filter(
      (r) => r.status !== 201 && r.body?.error?.code === 'INSUFFICIENT_STOCK',
    );
    const rateLimited = results.filter((r) => r.body?.error?.code === 'RATE_LIMITED');

    console.log(
      `Concurrency test results: ${successes.length} successes, ${stockErrors.length} stock errors, ${results.length - successes.length - stockErrors.length} other`,
    );

    // Exactly 10 should succeed (one per unit of stock)
    expect(successes.length).toBe(STOCK);

    // The remaining 90 should fail with INSUFFICIENT_STOCK
    expect(stockErrors.length).toBe(NUM_REQUESTS - STOCK);
    expect(rateLimited.length).toBe(0);

    // Verify inventory consistency
    const inventory = await testEnv.DB.prepare(
      'SELECT * FROM inventory WHERE sku_id = ?',
    )
      .bind('concurrency-product')
      .first<any>();

    expect(inventory).toBeDefined();
    expect(inventory!.total_stock).toBe(STOCK);
    expect(inventory!.reserved_count).toBe(STOCK);
    expect(inventory!.confirmed_count).toBe(0);

    // Available should be 0
    const available =
      inventory!.total_stock - inventory!.reserved_count - inventory!.confirmed_count;
    expect(available).toBe(0);

    // Verify number of pending reservations in DB
    const reservationCount = await testEnv.DB.prepare(
      `SELECT COUNT(*) as count FROM reservations WHERE sku_id = ? AND status = 'pending'`,
    )
      .bind('concurrency-product')
      .first<{ count: number }>();

    expect(reservationCount!.count).toBe(STOCK);
  });

  it('should handle concurrent confirms without double-counting', async () => {
    // First create 5 reservations sequentially
    const reservationIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await SELF.fetch('http://localhost/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `confirm-concurrency-${i}`,
          'CF-Connecting-IP': '198.51.100.201',
        },
        body: JSON.stringify({
          sku: 'SKU-CONCURRENCY',
          quantity: 1,
          user_id: `user-${i}`,
        }),
      });
      const body = await res.json() as any;
      reservationIds.push(body.data.id);
    }

    // Confirm all 5 simultaneously
    const confirmPromises = reservationIds.map((id, i) =>
      SELF.fetch(`http://localhost/api/reservations/${id}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `confirm-request-${i}`,
          'CF-Connecting-IP': '198.51.100.202',
        },
        body: JSON.stringify({ payment_reference: `PAY-CONC-${i}` }),
      }),
    );

    const confirmResponses = await Promise.all(confirmPromises);
    const confirmResults = await Promise.all(
      confirmResponses.map(async (r) => ({
        status: r.status,
        body: await r.json() as any,
      })),
    );

    // All 5 should succeed
    const confirmSuccesses = confirmResults.filter((r) => r.status === 200);
    expect(confirmSuccesses.length).toBe(5);

    // Verify inventory
    const inventory = await testEnv.DB.prepare(
      'SELECT * FROM inventory WHERE sku_id = ?',
    )
      .bind('concurrency-product')
      .first<any>();

    expect(inventory!.reserved_count).toBe(0); // All moved from reserved to confirmed
    expect(inventory!.confirmed_count).toBe(5);

    // Available stock should be 5 (10 total - 5 confirmed)
    const available =
      inventory!.total_stock - inventory!.reserved_count - inventory!.confirmed_count;
    expect(available).toBe(5);
  });

  it('should handle mixed concurrent reserve and cancel operations', async () => {
    // Create 5 reservations
    const reservationIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await SELF.fetch('http://localhost/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `mixed-concurrency-${i}`,
          'CF-Connecting-IP': '198.51.100.203',
        },
        body: JSON.stringify({
          sku: 'SKU-CONCURRENCY',
          quantity: 1,
          user_id: `user-${i}`,
        }),
      });
      const body = await res.json() as any;
      reservationIds.push(body.data.id);
    }

    // Cancel first 3 and try to reserve 8 more simultaneously
    const cancelPromises = reservationIds.slice(0, 3).map((id) =>
      SELF.fetch(`http://localhost/api/reservations/${id}/cancel`, {
        method: 'POST',
      }),
    );

    const reservePromises = Array.from({ length: 8 }, (_, i) =>
      SELF.fetch('http://localhost/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `mixed-new-${i}`,
          'CF-Connecting-IP': '198.51.100.204',
        },
        body: JSON.stringify({
          sku: 'SKU-CONCURRENCY',
          quantity: 1,
          user_id: `new-user-${i}`,
        }),
      }),
    );

    const allResults = await Promise.all([...cancelPromises, ...reservePromises]);
    const cancelResults = allResults.slice(0, 3);
    const reserveResults = allResults.slice(3);

    // All 3 cancels should succeed
    for (const r of cancelResults) {
      expect(r.status).toBe(200);
    }

    // Parse reserve results
    const reserveStatuses = await Promise.all(
      reserveResults.map(async (r) => ({
        status: r.status,
        body: await r.json() as any,
      })),
    );

    const newSuccesses = reserveStatuses.filter((r) => r.status === 201);
    const newFailures = reserveStatuses.filter((r) => r.status !== 201);

    // After cancelling 3 of 5, available = 10 - 2 = 8, so all 8 new should succeed
    expect(newSuccesses.length).toBe(8);

    // Verify final inventory state
    const inventory = await testEnv.DB.prepare(
      'SELECT * FROM inventory WHERE sku_id = ?',
    )
      .bind('concurrency-product')
      .first<any>();

    // 2 original + 8 new = 10 reserved
    expect(inventory!.reserved_count).toBe(10);
    expect(inventory!.confirmed_count).toBe(0);

    const available =
      inventory!.total_stock - inventory!.reserved_count - inventory!.confirmed_count;
    expect(available).toBe(0);
  });
});
