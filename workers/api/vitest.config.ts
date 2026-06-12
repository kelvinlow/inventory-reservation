import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    globals: true,
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
        },
        miniflare: {
          bindings: {
            ADMIN_API_KEY: 'test-admin-key',
            INTERNAL_API_KEY: 'test-internal-key',
          },
          d1Databases: ['DB'],
          durableObjects: {
            INVENTORY_DO: 'InventoryReservationDO',
          },
        },
      },
    },
  },
});
