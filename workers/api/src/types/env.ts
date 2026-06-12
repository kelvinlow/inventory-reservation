export interface Env {
  // D1 Database
  DB: D1Database;

  // Durable Objects
  INVENTORY_DO: DurableObjectNamespace;

  // Secrets/config
  ADMIN_API_KEY?: string;
  INTERNAL_API_KEY?: string;

  // Optional: environment-specific settings
  ENVIRONMENT?: string;
  RATE_LIMIT_MAX?: string;
  RATE_LIMIT_WINDOW_MS?: string;
}
