-- Initial schema for the inventory reservation system

-- Products table
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_products_sku ON products (sku);
CREATE INDEX idx_products_status ON products (status);

-- Inventory table
CREATE TABLE inventory (
  sku_id TEXT PRIMARY KEY,
  total_stock INTEGER NOT NULL CHECK (total_stock >= 0),
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  confirmed_count INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_count >= 0),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sku_id) REFERENCES products(id)
);

-- Reservations table
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
CREATE INDEX idx_reservations_idempotency_key
  ON reservations (idempotency_key);
CREATE INDEX idx_reservations_user_id
  ON reservations (user_id);

-- Orders table
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  payment_reference TEXT,
  confirmation_idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id)
);

CREATE INDEX idx_orders_reservation_id ON orders (reservation_id);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_confirmation_idempotency_key ON orders (confirmation_idempotency_key);

-- Audit log table
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

CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_log_action ON audit_log (action);
CREATE INDEX idx_audit_log_created_at ON audit_log (created_at);
