import express, { type Express, type RequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config.js';
import type { Database } from '../db.js';
import { accountRoutes } from '../routes/account.js';
import { adminRoutes } from '../routes/admin.js';
import { groupRoutes } from '../routes/group.js';
import { reportRoutes } from '../routes/reports.js';
import type { Notifications } from '../services/notifications.js';
import { errorMiddleware, notFound } from './errors.js';
import { telegramAuth, writeRateLimit } from './telegramAuth.js';

export interface Deps {
  config: Config;
  database: Database;
  notifications: Notifications;
}

export function inviteLink(config: Pick<Config, 'BOT_USERNAME'>, code: string): string {
  return `https://t.me/${config.BOT_USERNAME}?start=${code}`;
}

export function createApp(deps: Deps, options: { webhook?: RequestHandler; webDist?: string } = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  if (options.webhook) app.post('/telegram/webhook', express.json(), options.webhook);

  app.get('/api/health', (_req, res, next) => {
    deps.database.pool
      .query('select 1')
      .then(() => res.json({ ok: true }))
      .catch(next);
  });

  const api = express.Router();
  api.use(express.json({ limit: '6mb' }));
  api.use(telegramAuth(deps.database, deps.config.BOT_TOKEN, deps.config.INIT_DATA_MAX_AGE_SECONDS));
  api.use(writeRateLimit(120));
  accountRoutes(api, deps);
  groupRoutes(api, deps);
  reportRoutes(api, deps);
  adminRoutes(api, deps);
  api.use((_req, _res, next) => next(notFound('Такого адреса нет.')));
  app.use('/api', api);

  const webDist = options.webDist;
  if (webDist && existsSync(join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET') {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(webDist, 'index.html'));
    });
  }

  app.use(errorMiddleware);
  return app;
}
