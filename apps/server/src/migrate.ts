/** Ручной запуск миграций: npm run db:migrate. */
import { applyMigrations, withClient } from './setup.js';

await withClient(
  {
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    DATABASE_SSL: process.env.DATABASE_SSL === 'require' ? 'require' : 'off',
    DATABASE_CA_CERT: process.env.DATABASE_CA_CERT,
    DATABASE_POOL_MAX: 1,
  },
  applyMigrations,
);
console.log('Миграции применены');
