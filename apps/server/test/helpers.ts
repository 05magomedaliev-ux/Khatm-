import { createHmac, randomInt } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Config } from '../src/config.js';
import { createDatabase, type Database } from '../src/db.js';
import { createApp } from '../src/http/app.js';
import type { Messenger, MessageButton } from '../src/services/messenger.js';
import { Notifications } from '../src/services/notifications.js';

export const BOT_TOKEN = '1234567:TEST-token-for-integration';

export function signInitData(user: Record<string, unknown>, authDate = Math.floor(Date.now() / 1000), token = BOT_TOKEN): string {
  const fields: Record<string, string> = { auth_date: String(authDate), query_id: 'test', user: JSON.stringify(user) };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

export class RecordingMessenger implements Messenger {
  sent: { chatId: number; html: string; button?: MessageButton; threadId?: number }[] = [];
  photos: { chatId: number; image: Buffer; caption: string; button?: MessageButton; threadId?: number }[] = [];
  async send(chatId: number, html: string, button?: MessageButton, threadId?: number): Promise<void> {
    this.sent.push({ chatId, html, button, threadId });
  }
  async sendPhoto(chatId: number, image: Buffer, caption: string, button?: MessageButton, threadId?: number): Promise<void> {
    this.photos.push({ chatId, image, caption, button, threadId });
  }
}

export interface Harness {
  url: string;
  database: Database;
  messenger: RecordingMessenger;
  notifications: Notifications;
  close(): Promise<void>;
}

export async function startHarness(databaseUrl: string): Promise<Harness> {
  const config = {
    DATABASE_URL: databaseUrl,
    DATABASE_SSL: 'off',
    DATABASE_POOL_MAX: 10,
    BOT_TOKEN,
    BOT_USERNAME: 'khatm_test_bot',
    WEBAPP_URL: 'https://example.test/app',
    BOT_MODE: 'off',
    PORT: 0,
    INIT_DATA_MAX_AGE_SECONDS: 86_400,
  } as Config;
  const database = createDatabase(config);
  const messenger = new RecordingMessenger();
  const notifications = new Notifications(database, messenger, config);
  const app = createApp({ config, database, notifications });
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    database,
    messenger,
    notifications,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await database.close();
    },
  };
}

export function telegramIdBase(): number {
  return randomInt(1_000_000, 2_000_000_000);
}

export interface Client {
  tgId: number;
  call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }>;
}

export function client(url: string, tgId: number, firstName: string): Client {
  const initData = signInitData({ id: tgId, first_name: firstName });
  return {
    tgId,
    async call(method, path, body) {
      const response = await fetch(`${url}/api${path}`, {
        method,
        headers: { Authorization: `tma ${initData}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      return { status: response.status, body: (text ? JSON.parse(text) : undefined) as any };
    },
  };
}
