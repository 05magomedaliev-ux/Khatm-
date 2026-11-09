import { Bot, GrammyError, InlineKeyboard, InputFile } from 'grammy';
import { randomBytes } from 'node:crypto';
import type { Config } from '../config.js';
import type { Database, Db } from '../db.js';
import { inviteLink } from '../http/app.js';
import { loadGroup } from '../services/analytics.js';
import { RecipientUnavailable, type MessageButton, type Messenger } from '../services/messenger.js';
import { escapeHtml, formatGroupStats } from '../services/notifications.js';

function translate(error: unknown): never {
  if (error instanceof GrammyError && (error.error_code === 403 || (error.error_code === 400 && /chat not found/i.test(error.description)))) {
    throw new RecipientUnavailable(error.description);
  }
  throw error;
}

function keyboard(button?: MessageButton): InlineKeyboard | undefined {
  if (!button) return undefined;
  if (button.webAppUrl) return new InlineKeyboard().webApp(button.text, button.webAppUrl);
  if (button.url) return new InlineKeyboard().url(button.text, button.url);
  return undefined;
}

export class TelegramMessenger implements Messenger {
  constructor(private bot: Bot) {}

  async send(chatId: number, html: string, button?: MessageButton): Promise<void> {
    await this.bot.api
      .sendMessage(chatId, html, { parse_mode: 'HTML', reply_markup: keyboard(button), link_preview_options: { is_disabled: true } })
      .catch(translate);
  }

  async sendPhoto(chatId: number, image: Buffer, caption: string): Promise<void> {
    await this.bot.api.sendPhoto(chatId, new InputFile(image, 'khatm-card.jpg'), { caption }).catch(translate);
  }
}

interface UserGroup {
  group_id: string;
  group_name: string;
  member_id: string;
  role: string;
}

async function groupsOf(db: Db, telegramId: number): Promise<UserGroup[]> {
  const { rows } = await db.query<UserGroup>(
    `select g.id as group_id, g.name as group_name, m.id as member_id, m.role
     from public.group_members m
     join public.groups g on g.id = m.group_id
     join public.users u on u.id = m.user_id
     where u.telegram_id = $1 and m.status = 'active'
     order by m.joined_at`,
    [telegramId],
  );
  return rows;
}

function withInvite(webappUrl: string, code: string): string {
  const url = new URL(webappUrl);
  url.searchParams.set('invite', code);
  return url.toString();
}

export function registerBot(bot: Bot, config: Config, database: Database): void {
  const openInPrivate = (text = 'Открыть приложение') => new InlineKeyboard().webApp(text, config.WEBAPP_URL);
  const openFromChat = () => new InlineKeyboard().url('Открыть приложение', `https://t.me/${config.BOT_USERNAME}?start=open`);
  const isPrivate = (type: string) => type === 'private';

  bot.command('start', async (ctx) => {
    if (!isPrivate(ctx.chat.type)) {
      await ctx.reply('Приложение открывается в личном чате с ботом.', { reply_markup: openFromChat() });
      return;
    }
    await database.withSystem((db) => db.query('update public.users set bot_blocked = false where telegram_id = $1', [ctx.from!.id]));
    const code = ctx.match?.trim();
    if (code && code !== 'open') {
      const invite = await database.withSystem(async (db) => {
        const { rows } = await db.query<{ name: string }>(
          `select g.name from public.invites i join public.groups g on g.id = i.group_id
           where i.code = $1 and i.revoked_at is null
             and (i.expires_at is null or i.expires_at > now())
             and (i.max_uses is null or i.used_count < i.max_uses)`,
          [code],
        );
        return rows[0];
      });
      if (!invite) {
        await ctx.reply('Это приглашение больше не действует. Попросите организатора прислать новое.');
        return;
      }
      await ctx.reply(`Вас приглашают в группу «${escapeHtml(invite.name)}». Откройте приложение и выберите своё имя.`, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().webApp('Присоединиться', withInvite(config.WEBAPP_URL, code)),
      });
      return;
    }
    await ctx.reply(
      'Хатм — наш путь. Читаем Коран вместе: отмечайте страницы, следите за нормой и поддерживайте друг друга.\n\nКоманды: /today, /stats, /invite, /help',
      { reply_markup: openInPrivate() },
    );
  });

  bot.command('app', async (ctx) => {
    if (isPrivate(ctx.chat.type)) await ctx.reply('Открыть приложение:', { reply_markup: openInPrivate() });
    else await ctx.reply('Приложение открывается в личном чате с ботом.', { reply_markup: openFromChat() });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '/app — открыть приложение',
        '/today — мой день',
        '/stats — статистика группы',
        '/invite — ссылка-приглашение (для администраторов)',
        '/link КОД — подключить этот чат к группе (код есть в настройках группы)',
      ].join('\n'),
    );
  });

  bot.command('invite', async (ctx) => {
    const lines = await database.withSystem(async (db) => {
      const groups = (await groupsOf(db, ctx.from!.id)).filter((g) => g.role === 'owner' || g.role === 'admin');
      const result: string[] = [];
      for (const group of groups) {
        const active = await db.query<{ code: string }>(
          `select code from public.invites
           where group_id = $1 and revoked_at is null and (expires_at is null or expires_at > now())
             and (max_uses is null or used_count < max_uses)
           order by created_at desc limit 1`,
          [group.group_id],
        );
        let code = active.rows[0]?.code;
        if (!code) {
          code = randomBytes(12).toString('hex');
          await db.query('insert into public.invites (group_id, code) values ($1, $2)', [group.group_id, code]);
        }
        result.push(`${escapeHtml(group.group_name)}:\n${inviteLink(config, code)}`);
      }
      return result;
    });
    if (lines.length === 0) {
      await ctx.reply('Приглашать участников могут администраторы группы.');
      return;
    }
    await ctx.reply(lines.join('\n\n'), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  });

  bot.command('stats', async (ctx) => {
    if (!isPrivate(ctx.chat.type)) {
      const text = await database.withSystem(async (db) => {
        const { rows } = await db.query<{ id: string }>('select id from public.groups where telegram_chat_id = $1', [ctx.chat.id]);
        if (!rows[0]) return null;
        const data = await loadGroup(db, rows[0].id);
        return data ? formatGroupStats(data, 'Статистика группы') : null;
      });
      await ctx.reply(text ?? 'Этот чат ещё не подключён к группе. Код подключения есть в настройках группы.', {
        parse_mode: 'HTML',
        reply_markup: text ? openFromChat() : undefined,
      });
      return;
    }
    const texts = await database.withSystem(async (db) => {
      const out: string[] = [];
      for (const group of await groupsOf(db, ctx.from!.id)) {
        const data = await loadGroup(db, group.group_id);
        if (data) out.push(formatGroupStats(data, 'Статистика группы'));
      }
      return out;
    });
    await ctx.reply(texts.join('\n\n') || 'Вы пока не состоите в группе.', { parse_mode: 'HTML', reply_markup: openInPrivate() });
  });

  bot.command('today', async (ctx) => {
    const text = await database.withSystem(async (db) => {
      const out: string[] = [];
      for (const group of await groupsOf(db, ctx.from!.id)) {
        const data = await loadGroup(db, group.group_id);
        const me = data?.members.find((m) => m.member.id === group.member_id);
        if (!me) continue;
        const state = me.stats.todayMet ? 'норма выполнена' : `осталось ${me.stats.remainingToday} стр.`;
        out.push(
          `<b>${escapeHtml(group.group_name)}</b>\nСегодня ${me.stats.today} стр., ${state}.\nДолг: ${me.stats.debt} стр. Серия: ${me.stats.currentStreak} дн.`,
        );
      }
      return out.join('\n\n');
    });
    await ctx.reply(text || 'Вы пока не состоите в группе.', { parse_mode: 'HTML' });
  });

  bot.command('link', async (ctx) => {
    if (isPrivate(ctx.chat.type)) {
      await ctx.reply('Отправьте эту команду в чате группы, куда добавлен бот.');
      return;
    }
    const code = ctx.match?.trim();
    if (!code) {
      await ctx.reply('Укажите код: /link КОД. Код есть в настройках группы в приложении.');
      return;
    }
    const linked = await database.withSystem(async (db) => {
      const { rows } = await db.query<{ name: string }>(
        `update public.groups set telegram_chat_id = $1, telegram_chat_title = $2, link_code = null
         where link_code = $3 returning name`,
        [ctx.chat.id, 'title' in ctx.chat ? ctx.chat.title : null, code],
      );
      return rows[0];
    });
    await ctx.reply(
      linked
        ? `Чат подключён к группе «${escapeHtml(linked.name)}». Итоги дня и статистика будут приходить сюда.`
        : 'Код не подошёл. Получите новый в настройках группы.',
      { parse_mode: 'HTML' },
    );
  });

  bot.catch((error) => {
    console.error('Ошибка обработки обновления', error.error);
  });
}

export async function configureBot(bot: Bot, config: Config): Promise<void> {
  await bot.api.setMyCommands([
    { command: 'app', description: 'Открыть приложение' },
    { command: 'today', description: 'Мой день' },
    { command: 'stats', description: 'Статистика группы' },
    { command: 'invite', description: 'Пригласить участников' },
    { command: 'help', description: 'Справка' },
  ]);
  await bot.api.setChatMenuButton({
    menu_button: { type: 'web_app', text: 'Хатм', web_app: { url: config.WEBAPP_URL } },
  });
}
