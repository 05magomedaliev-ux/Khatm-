import { achievementByCode, localMinutes, timeToMinutes } from '@khatm/shared';
import type { Config } from '../config.js';
import type { Database, Db } from '../db.js';
import { loadGroup, progressOf, summarizeToday, type GroupData, type GroupRow } from './analytics.js';
import { renderDayCard } from './daycard/render.js';
import { ChatMigrated, RecipientUnavailable, type MessageButton, type Messenger } from './messenger.js';

/** Сколько минут после назначенного времени рассылка ещё считается актуальной. */
const SEND_WINDOW_MINUTES = 120;

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function formatDayMonth(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Общая статистика без указания, кто не выполнил норму: сообщения поддерживают, а не стыдят. */
export function formatGroupStats(data: GroupData, heading: string): string {
  const day = summarizeToday(data);
  const progress = progressOf(data);
  const streak = Math.max(0, ...data.members.map((m) => m.stats.currentStreak));
  const lines = [
    `<b>${escapeHtml(heading)}</b>`,
    `Группа «${escapeHtml(data.group.name)}», ${formatDayMonth(data.today)}`,
    '',
    `Сегодня прочитано: ${day.pages} стр. при цели ${day.groupGoal}`,
    `Норму выполнили: ${day.metCount} из ${day.startedCount}`,
    `Всего: ${progress.totalPages} из ${progress.goalPages} стр. (${progress.percent}%)`,
  ];
  if (streak > 1) lines.push(`Самая длинная серия: ${streak} дн.`);
  return lines.join('\n');
}

/** Итоги дня картинкой. Если нарисовать её не удалось, итоги уходят обычным текстом. */
export async function buildDayReport(data: GroupData, heading: string): Promise<{ html: string; image?: Buffer }> {
  try {
    const image = await renderDayCard(data);
    return { image, html: `<b>${escapeHtml(heading)}</b>\nГруппа «${escapeHtml(data.group.name)}», ${formatDayMonth(data.today)}` };
  } catch (error) {
    console.error('Не удалось нарисовать итоги дня', error);
    return { html: formatGroupStats(data, heading) };
  }
}

export class Notifications {
  constructor(
    private database: Database,
    private messenger: Messenger,
    private config: Pick<Config, 'WEBAPP_URL' | 'BOT_USERNAME'>,
  ) {}

  private privateButton(text = 'Открыть приложение') {
    return { text, webAppUrl: this.config.WEBAPP_URL };
  }

  private chatButton(text = 'Открыть приложение') {
    return { text, url: `https://t.me/${this.config.BOT_USERNAME}?start=open` };
  }

  private async sendPrivate(telegramId: number, html: string, buttonText?: string, image?: Buffer): Promise<boolean> {
    try {
      if (image) await this.messenger.sendPhoto(telegramId, image, html, this.privateButton(buttonText));
      else await this.messenger.send(telegramId, html, this.privateButton(buttonText));
      return true;
    } catch (error) {
      if (error instanceof RecipientUnavailable) {
        await this.database.withSystem((db) => db.query('update public.users set bot_blocked = true where telegram_id = $1', [telegramId]));
        return false;
      }
      console.error('Не удалось отправить сообщение', error);
      return false;
    }
  }

  /** При переходе чата в супергруппу Telegram меняет его id: запоминаем новый и отправляем туда. */
  private async sendToChat(
    groupId: string,
    chat: { id: number; threadId: number | null },
    html: string,
    button?: MessageButton,
    image?: Buffer,
  ): Promise<void> {
    const thread = chat.threadId ?? undefined;
    const deliver = (id: number) => (image ? this.messenger.sendPhoto(id, image, html, button, thread) : this.messenger.send(id, html, button, thread));
    try {
      await deliver(chat.id);
    } catch (error) {
      if (!(error instanceof ChatMigrated)) throw error;
      await this.database.withSystem((db) => db.query('update public.groups set telegram_chat_id = $2 where id = $1', [groupId, error.newChatId]));
      await deliver(error.newChatId);
    }
  }

  async publishStats(groupId: string): Promise<boolean> {
    const data = await this.database.withSystem((db) => loadGroup(db, groupId));
    if (!data?.group.telegram_chat_id) return false;
    const report = await buildDayReport(data, 'Итоги дня');
    await this.sendToChat(groupId, { id: data.group.telegram_chat_id, threadId: data.group.telegram_thread_id }, report.html, this.chatButton(), report.image);
    return true;
  }

  /** Отправляет персональную карточку в личный чат с ботом. */
  async sendCard(telegramId: number, image: Buffer): Promise<void> {
    await this.messenger.sendPhoto(telegramId, image, 'Ваша карточка. Её можно переслать группе.');
  }

  /** Очередь достижений: метка ставится до отправки, поэтому при сбое повторной рассылки не будет. */
  async flushAchievements(): Promise<void> {
    const claimed = await this.database.withSystem(async (db) => {
      const { rows } = await db.query<{
        id: string; code: string; group_id: string; member_id: string; display_name: string;
        telegram_id: number | null; bot_blocked: boolean | null; enabled: boolean | null; chat_id: number | null; thread_id: number | null;
      }>(
        `update public.achievements a set notified_at = now()
         from public.group_members m
         join public.groups g on g.id = m.group_id
         left join public.users u on u.id = m.user_id
         left join public.member_settings s on s.member_id = m.id
         where a.id in (
           select id from public.achievements
           where notified_at is null and revoked_at is null
           order by earned_at limit 100 for update skip locked
         ) and m.id = a.member_id
         returning a.id, a.code, a.group_id, a.member_id, m.display_name, u.telegram_id, u.bot_blocked,
                   s.achievements_enabled as enabled, g.telegram_chat_id as chat_id, g.telegram_thread_id as thread_id`,
      );
      return rows;
    });

    for (const row of claimed) {
      const def = achievementByCode(row.code);
      if (!def) continue;
      if (row.telegram_id && !row.bot_blocked && row.enabled !== false) {
        await this.sendPrivate(row.telegram_id, `<b>Новое достижение</b>\n${escapeHtml(def.title)}. ${escapeHtml(def.description)}.`);
      }
      if (row.chat_id) {
        await this.sendToChat(row.group_id, { id: row.chat_id, threadId: row.thread_id }, `${escapeHtml(row.display_name)} получает достижение «${escapeHtml(def.title)}».`)
          .catch((e) => console.error('Не удалось отправить в чат группы', e));
      }
    }
  }

  private async claim(db: Db, kind: 'reminder' | 'daily_report', groupId: string, memberId: string | null, localDate: string): Promise<boolean> {
    const { rows } = await db.query(
      `insert into public.notification_log (kind, group_id, member_id, local_date)
       values ($1, $2, $3, $4)
       on conflict do nothing
       returning id`,
      [kind, groupId, memberId, localDate],
    );
    return rows.length > 0;
  }

  /** Один проход планировщика. Вызывается раз в минуту; повторы отсекает notification_log. */
  async tick(now: Date = new Date()): Promise<void> {
    const groups = await this.database.withSystem(async (db) => (await db.query<GroupRow>('select * from public.groups')).rows);
    for (const group of groups) {
      try {
        await this.processGroup(group, now);
      } catch (error) {
        console.error(`Ошибка рассылки для группы ${group.id}`, error);
      }
    }
    await this.flushAchievements();
  }

  private inWindow(scheduled: string, minutesNow: number): boolean {
    const start = timeToMinutes(scheduled);
    return minutesNow >= start && minutesNow < start + SEND_WINDOW_MINUTES;
  }

  private async processGroup(group: GroupRow, now: Date): Promise<void> {
    const minutes = localMinutes(group.timezone, now);
    const recipients = await this.database.withSystem(async (db) => {
      const { rows } = await db.query<{
        member_id: string; telegram_id: number; reminders_enabled: boolean | null; reminder_time: string | null; daily_report_enabled: boolean | null;
      }>(
        `select m.id as member_id, u.telegram_id, s.reminders_enabled, s.reminder_time, s.daily_report_enabled
         from public.group_members m
         join public.users u on u.id = m.user_id and not u.bot_blocked
         left join public.member_settings s on s.member_id = m.id
         where m.group_id = $1 and m.status = 'active'`,
        [group.id],
      );
      return rows;
    });

    const dueReminders = group.reminders_enabled
      ? recipients.filter((r) => r.reminders_enabled !== false && this.inWindow(r.reminder_time ?? group.reminder_time, minutes))
      : [];
    const reportDue = group.reports_enabled && this.inWindow(group.report_time, minutes);
    if (dueReminders.length === 0 && !reportDue) return;

    const data = await this.database.withSystem((db) => loadGroup(db, group.id, now));
    if (!data) return;

    for (const recipient of dueReminders) {
      const member = data.members.find((m) => m.member.id === recipient.member_id);
      if (!member || member.stats.todayMet || member.ledger.length === 0) continue;
      const claimed = await this.database.withSystem((db) => this.claim(db, 'reminder', group.id, recipient.member_id, data.today));
      if (!claimed) continue;
      const left = member.stats.remainingToday;
      await this.sendPrivate(
        recipient.telegram_id,
        `Сегодня осталось прочитать ${left} стр.\nГруппа «${escapeHtml(group.name)}» уже прочитала ${summarizeToday(data).pages} стр.`,
        'Внести результат',
      );
    }

    if (!reportDue) return;
    const report = await buildDayReport(data, 'Итоги дня');
    if (group.telegram_chat_id) {
      const claimed = await this.database.withSystem((db) => this.claim(db, 'daily_report', group.id, null, data.today));
      if (claimed) await this.sendToChat(group.id, { id: group.telegram_chat_id, threadId: group.telegram_thread_id }, report.html, this.chatButton(), report.image);
      return;
    }
    for (const recipient of recipients) {
      if (recipient.daily_report_enabled === false) continue;
      const claimed = await this.database.withSystem((db) => this.claim(db, 'daily_report', group.id, recipient.member_id, data.today));
      if (claimed) await this.sendPrivate(recipient.telegram_id, report.html, undefined, report.image);
    }
  }
}
