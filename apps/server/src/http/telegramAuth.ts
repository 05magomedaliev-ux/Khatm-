import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import type { Database } from '../db.js';
import { HttpError } from './errors.js';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

/**
 * Проверка подписи initData по алгоритму Telegram. Только эта функция решает,
 * кто пользователь: initDataUnsafe на клиенте для авторизации не используется.
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number,
  nowMs: number = Date.now(),
): { user: TelegramUser; startParam: string | null } | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secret).update(dataCheckString).digest();
  if (!timingSafeEqual(computed, Buffer.from(hash, 'hex'))) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  const age = nowMs / 1000 - authDate;
  if (age > maxAgeSeconds || age < -300) return null;

  const rawUser = params.get('user');
  if (!rawUser) return null;
  try {
    const user = JSON.parse(rawUser) as TelegramUser;
    if (typeof user.id !== 'number' || typeof user.first_name !== 'string') return null;
    return { user, startParam: params.get('start_param') };
  } catch {
    return null;
  }
}

export interface AuthedUser {
  id: string;
  telegramId: number;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
}

export function currentUser(res: Response): AuthedUser {
  return res.locals.user as AuthedUser;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 20_000;

export function telegramAuth(database: Database, botToken: string, maxAgeSeconds: number): RequestHandler {
  // Кэш избавляет от записи в users на каждый запрос. Подпись проверяется всегда.
  const cache = new Map<string, { user: AuthedUser; expires: number }>();

  return (req, res, next) => {
    const header = req.header('authorization') ?? '';
    if (!header.startsWith('tma ')) {
      next(new HttpError(401, 'unauthorized', 'Откройте приложение через Telegram.'));
      return;
    }
    const initData = header.slice(4);
    const verified = validateInitData(initData, botToken, maxAgeSeconds);
    if (!verified) {
      next(new HttpError(401, 'unauthorized', 'Сессия устарела. Закройте и снова откройте приложение.'));
      return;
    }
    const tg = verified.user;
    const key = `${tg.id}:${tg.first_name}:${tg.username ?? ''}:${tg.photo_url ?? ''}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) {
      res.locals.user = cached.user;
      next();
      return;
    }
    database
      .withSystem(async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `insert into public.users (telegram_id, first_name, last_name, username, photo_url, language_code)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (telegram_id) do update set
             first_name = excluded.first_name, last_name = excluded.last_name, username = excluded.username,
             photo_url = excluded.photo_url, language_code = excluded.language_code, last_seen_at = now()
           returning id`,
          [tg.id, tg.first_name, tg.last_name ?? null, tg.username ?? null, tg.photo_url ?? null, tg.language_code ?? null],
        );
        return rows[0].id;
      })
      .then((id) => {
        const user: AuthedUser = {
          id,
          telegramId: tg.id,
          firstName: tg.first_name,
          username: tg.username ?? null,
          photoUrl: tg.photo_url ?? null,
        };
        if (cache.size >= CACHE_MAX) cache.clear();
        cache.set(key, { user, expires: Date.now() + CACHE_TTL_MS });
        res.locals.user = user;
        next();
      })
      .catch(next);
  };
}

/** Ограничение частоты записи на пользователя: защита от случайных циклов и злоупотреблений. */
export function writeRateLimit(limitPerMinute: number): RequestHandler {
  const hits = new Map<number, { count: number; resetAt: number }>();
  return (req, res, next) => {
    if (req.method === 'GET') {
      next();
      return;
    }
    const id = currentUser(res).telegramId;
    const now = Date.now();
    const entry = hits.get(id);
    if (!entry || entry.resetAt < now) {
      if (hits.size > 50_000) hits.clear();
      hits.set(id, { count: 1, resetAt: now + 60_000 });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > limitPerMinute) {
      next(new HttpError(429, 'rate_limited', 'Слишком много запросов. Подождите минуту.'));
      return;
    }
    next();
  };
}
