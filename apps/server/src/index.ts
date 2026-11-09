import { Bot, webhookCallback } from 'grammy';
import { fileURLToPath } from 'node:url';
import { configureBot, registerBot, TelegramMessenger } from './bot/index.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { createApp } from './http/app.js';
import { NullMessenger, type Messenger } from './services/messenger.js';
import { Notifications } from './services/notifications.js';
import { runAutoSetup } from './setup.js';

const config = loadConfig();
if (config.AUTO_SETUP === 'on') await runAutoSetup(config);
const database = createDatabase(config);
const bot = config.BOT_MODE === 'off' ? null : new Bot(config.BOT_TOKEN);
const messenger: Messenger = bot ? new TelegramMessenger(bot) : new NullMessenger();
const notifications = new Notifications(database, messenger, config);

if (bot) registerBot(bot, config, database);

const webhook =
  bot && config.BOT_MODE === 'webhook'
    ? webhookCallback(bot, 'express', { secretToken: config.WEBHOOK_SECRET })
    : undefined;

const webDist = config.WEB_DIST ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
const app = createApp({ config, database, notifications }, { webhook, webDist });

const server = app.listen(config.PORT, () => {
  console.log(`Сервер запущен на порту ${config.PORT}`);
});

if (bot) {
  configureBot(bot, config).catch((e) => console.error('Не удалось настроить бота', e));
  if (config.BOT_MODE === 'webhook') {
    const url = new URL('/telegram/webhook', config.WEBAPP_URL).toString();
    bot.api.setWebhook(url, { secret_token: config.WEBHOOK_SECRET }).catch((e) => console.error('Не удалось установить webhook', e));
  } else {
    bot.api
      .deleteWebhook()
      .then(() => bot.start({ drop_pending_updates: true }))
      .catch((e) => console.error('Бот остановлен', e));
  }
}

// Планировщик: следующий проход начинается только после завершения предыдущего.
let stopped = false;
let timer: NodeJS.Timeout;
async function loop(): Promise<void> {
  try {
    await notifications.tick();
  } catch (error) {
    console.error('Ошибка планировщика', error);
  }
  if (!stopped) timer = setTimeout(loop, 60_000);
}
timer = setTimeout(loop, 5_000);

async function shutdown(): Promise<void> {
  stopped = true;
  clearTimeout(timer);
  server.close();
  if (bot && config.BOT_MODE === 'polling') await bot.stop().catch(() => undefined);
  await database.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
