-- Seed data: Sample products and inventory

DELETE FROM audit_log;
DELETE FROM orders;
DELETE FROM reservations;
DELETE FROM inventory;
DELETE FROM products;

INSERT INTO products (id, sku, name, description, status, created_at, updated_at) VALUES
  ('prod_flash_001', 'SKU-FLASH-001', 'Flash Sale Sneakers', 'Limited edition sneakers for the flash sale event. Premium materials with exclusive colorway.', 'active', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
  ('prod_flash_002', 'SKU-FLASH-002', 'Limited Edition Watch', 'Swiss-made automatic watch with sapphire crystal. Only 25 pieces available worldwide.', 'active', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
  ('prod_flash_003', 'SKU-FLASH-003', 'Premium Headphones', 'Active noise-cancelling over-ear headphones with 40-hour battery life and Hi-Res Audio.', 'active', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
  ('prod_flash_004', 'SKU-FLASH-004', 'Designer Backpack', 'Handcrafted Italian leather backpack with laptop compartment. Water-resistant design.', 'active', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
  ('prod_flash_005', 'SKU-FLASH-005', 'Smart Fitness Tracker', 'Advanced fitness tracker with GPS, heart rate monitor, blood oxygen sensor, and 14-day battery.', 'active', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');

INSERT INTO inventory (sku_id, total_stock, reserved_count, confirmed_count, version, updated_at) VALUES
  ('prod_flash_001', 50, 0, 0, 0, '2025-01-01T00:00:00.000Z'),
  ('prod_flash_002', 25, 0, 0, 0, '2025-01-01T00:00:00.000Z'),
  ('prod_flash_003', 100, 0, 0, 0, '2025-01-01T00:00:00.000Z'),
  ('prod_flash_004', 30, 0, 0, 0, '2025-01-01T00:00:00.000Z'),
  ('prod_flash_005', 75, 0, 0, 0, '2025-01-01T00:00:00.000Z');
