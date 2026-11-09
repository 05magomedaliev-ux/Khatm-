import { readFileSync } from 'node:fs';
import pg, { type Pool, type PoolClient, type PoolConfig } from 'pg';
import type { Config } from './config.js';

// Календарные даты остаются строками YYYY-MM-DD: преобразование в Date сдвигало бы их на часовой пояс сервера.
pg.types.setTypeParser(1082, (value: string) => value);
pg.types.setTypeParser(20, (value: string) => Number(value));

export interface Db {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

export interface Database {
  pool: Pool;
  /** Запрос пользователя: транзакция под ролью khatm_app, действует RLS. */
  withUser<T>(userId: string, fn: (db: Db) => Promise<T>): Promise<T>;
  /** Системные задачи и вход по приглашению: транзакция от имени владельца таблиц. */
  withSystem<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function connectionOptions(config: Pick<Config, 'DATABASE_URL' | 'DATABASE_SSL' | 'DATABASE_CA_CERT' | 'DATABASE_POOL_MAX'>): PoolConfig {
  // sslmode из строки подключения перекрыл бы настройки ssl ниже.
  const url = new URL(config.DATABASE_URL);
  url.searchParams.delete('sslmode');
  const options: PoolConfig = { connectionString: url.toString(), max: config.DATABASE_POOL_MAX };
  if (config.DATABASE_CA_CERT) {
    options.ssl = { ca: readFileSync(config.DATABASE_CA_CERT, 'utf8'), rejectUnauthorized: true };
  } else if (config.DATABASE_SSL === 'require') {
    options.ssl = { rejectUnauthorized: false };
  }
  return options;
}

export function createDatabase(config: Parameters<typeof connectionOptions>[0]): Database {
  const pool = new pg.Pool(connectionOptions(config));
  pool.on('error', (error) => console.error('Ошибка простаивающего соединения с базой', error));

  async function transaction<T>(setup: ((client: PoolClient) => Promise<void>) | null, fn: (db: Db) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      if (setup) await setup(client);
      const result = await fn(client as unknown as Db);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    pool,
    withUser: (userId, fn) =>
      transaction(async (client) => {
        await client.query('set local role khatm_app');
        await client.query(`select set_config('app.user_id', $1, true)`, [userId]);
      }, fn),
    withSystem: (fn) => transaction(null, fn),
    close: () => pool.end(),
  };
}
