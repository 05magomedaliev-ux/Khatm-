import { createHash } from 'node:crypto';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'Укажите строку подключения к базе'),
  DATABASE_SSL: z.enum(['off', 'require']).default('off'),
  DATABASE_CA_CERT: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  BOT_TOKEN: z.string().min(10, 'Укажите токен бота от @BotFather'),
  BOT_USERNAME: z.string().min(1, 'Укажите имя бота без @'),
  WEBAPP_URL: z.string().url('Укажите HTTPS-адрес приложения'),
  BOT_MODE: z.enum(['polling', 'webhook', 'off']).default('polling'),
  WEBHOOK_SECRET: z.string().optional(),
  PORT: z.coerce.number().int().default(3000),
  INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86_400),
  WEB_DIST: z.string().optional(),
  /** on: при запуске сервер сам создаёт таблицы и первую группу. */
  AUTO_SETUP: z.enum(['on', 'off']).default('off'),
});

export type Config = z.infer<typeof schema>;

/** На Render большинство настроек известно заранее: вручную задаются только база и бот. */
function withPlatformDefaults(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!env.RENDER) return env;
  return {
    ...env,
    WEBAPP_URL: env.WEBAPP_URL ?? env.RENDER_EXTERNAL_URL,
    BOT_MODE: env.BOT_MODE ?? 'webhook',
    DATABASE_SSL: env.DATABASE_SSL ?? 'require',
    AUTO_SETUP: env.AUTO_SETUP ?? 'on',
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(withPlatformDefaults(env));
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Неверные переменные окружения:\n${problems}`);
  }
  const config = parsed.data;
  if (config.BOT_MODE === 'webhook' && !config.WEBHOOK_SECRET) {
    // Секрет выводится из токена: он стабилен между перезапусками и не хранится отдельно.
    config.WEBHOOK_SECRET = createHash('sha256').update(`khatm-webhook:${config.BOT_TOKEN}`).digest('hex');
  }
  return config;
}
