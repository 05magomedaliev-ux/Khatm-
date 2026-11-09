/** Создание таблиц и первой группы без SQL-редактора. */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Config } from './config.js';
import { connectionOptions } from './db.js';

const SUPABASE_DIR = process.env.SUPABASE_DIR ?? fileURLToPath(new URL('../../../supabase', import.meta.url));
const SEED_GROUP_ID = '11111111-1111-4111-8111-111111111111';

type DbConfig = Parameters<typeof connectionOptions>[0];

export async function withClient<T>(config: DbConfig, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(connectionOptions(config));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Применяет supabase/migrations/*.sql по порядку; уже применённые пропускает. */
export async function applyMigrations(client: pg.Client): Promise<void> {
  const dir = process.env.MIGRATIONS_DIR ?? resolve(SUPABASE_DIR, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  await client.query('create schema if not exists app');
  await client.query('create table if not exists app.migrations (name text primary key, applied_at timestamptz not null default now())');
  const applied = new Set<string>((await client.query('select name from app.migrations')).rows.map((r) => r.name as string));

  if (applied.size === 0 && (await client.query(`select to_regclass('public.users') as t`)).rows[0].t) {
    // Схема уже создана вручную через SQL-редактор: запоминаем это и не применяем повторно.
    for (const name of files) await client.query('insert into app.migrations (name) values ($1)', [name]);
    return;
  }

  for (const name of files) {
    if (applied.has(name)) continue;
    console.log(`Применяю ${name}`);
    await client.query('begin');
    try {
      await client.query(readFileSync(resolve(dir, name), 'utf8'));
      await client.query('insert into app.migrations (name) values ($1)', [name]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  }
}

export async function runAutoSetup(config: DbConfig & Pick<Config, 'BOT_USERNAME'>): Promise<void> {
  await withClient(config, async (client) => {
    await applyMigrations(client);

    // Первая группа создаётся один раз: удаления и правки администратора не откатываются при перезапуске.
    const seeded = await client.query(`select 1 from app.migrations where name = 'seed.sql'`);
    if (seeded.rows.length === 0) {
      await client.query(readFileSync(resolve(SUPABASE_DIR, 'seed.sql'), 'utf8'));
      await client.query(`insert into app.migrations (name) values ('seed.sql')`);
    }

    // Ссылка нужна только до первого входа владельца.
    const { rows } = await client.query(
      `select i.code from public.invites i
       where i.group_id = $1 and i.revoked_at is null
         and not exists (
           select 1 from public.group_members m
           where m.group_id = i.group_id and m.role = 'owner' and m.status = 'active'
         )
       order by i.created_at limit 1`,
      [SEED_GROUP_ID],
    );
    if (rows[0]) console.log(`Первая ссылка: https://t.me/${config.BOT_USERNAME}?start=${rows[0].code}`);
  });
}
