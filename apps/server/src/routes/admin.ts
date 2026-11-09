import type { AdminResponse, GroupSettingsView, InviteView, MemberAdminView, MemberNotificationSettings } from '@khatm/shared';
import type { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { Db } from '../db.js';
import { inviteLink, type Deps } from '../http/app.js';
import { forbidden, handle, HttpError, invalid, notFound } from '../http/errors.js';
import { addMemberSchema, cardSchema, memberUpdateSchema, notificationsSchema, pagesBeforeSchema, param, settingsSchema } from '../http/schemas.js';
import { currentUser } from '../http/telegramAuth.js';
import { isAdmin, requireAdmin, requireMember } from '../services/access.js';
import { loadGroup, type GroupData } from '../services/analytics.js';
import { RecipientUnavailable } from '../services/messenger.js';
import { syncAchievements } from '../services/reports.js';

const hhmm = (time: string) => time.slice(0, 5);

function settingsView(data: GroupData): GroupSettingsView {
  const g = data.group;
  return {
    id: g.id,
    name: g.name,
    timezone: g.timezone,
    dailyMinimum: data.dailyMinimum,
    reminderTime: hhmm(g.reminder_time),
    reportTime: hhmm(g.report_time),
    remindersEnabled: g.reminders_enabled,
    reportsEnabled: g.reports_enabled,
    chatTitle: g.telegram_chat_title,
    chatLinked: g.telegram_chat_id !== null,
    linkCode: g.link_code,
  };
}

async function notifications(db: Db, memberId: string, group: GroupData['group']): Promise<MemberNotificationSettings> {
  const { rows } = await db.query<{ reminders_enabled: boolean; reminder_time: string | null; daily_report_enabled: boolean; achievements_enabled: boolean }>(
    'select reminders_enabled, reminder_time, daily_report_enabled, achievements_enabled from public.member_settings where member_id = $1',
    [memberId],
  );
  const s = rows[0];
  return {
    remindersEnabled: s?.reminders_enabled ?? true,
    reminderTime: s?.reminder_time ? hhmm(s.reminder_time) : null,
    dailyReportEnabled: s?.daily_report_enabled ?? true,
    achievementsEnabled: s?.achievements_enabled ?? true,
    groupReminderTime: hhmm(group.reminder_time),
  };
}

function newCode(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function adminRoutes(router: Router, deps: Deps): void {
  const { database, config } = deps;

  const toInvite = (row: { id: string; code: string; used_count: number; max_uses: number | null; expires_at: Date | null; created_at: Date }): InviteView => ({
    id: row.id,
    code: row.code,
    link: inviteLink(config, row.code),
    usedCount: row.used_count,
    maxUses: row.max_uses,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  });

  router.get('/groups/:gid/admin', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const user = currentUser(res);
    const body = await database.withUser(user.id, async (db): Promise<AdminResponse> => {
      const me = await requireAdmin(db, groupId, user.id);
      const data = await loadGroup(db, groupId);
      if (!data) throw notFound();
      const members = await db.query<{ id: string; display_name: string; role: MemberAdminView['role']; status: MemberAdminView['status']; user_id: string | null; started_on: string | null; username: string | null }>(
        `select m.id, m.display_name, m.role, m.status, m.user_id, m.started_on, u.username
         from public.group_members m left join public.users u on u.id = m.user_id
         where m.group_id = $1 and m.status <> 'removed'
         order by m.created_at, m.id`,
        [groupId],
      );
      const invites = await db.query(
        `select id, code, used_count, max_uses, expires_at, created_at from public.invites
         where group_id = $1 and revoked_at is null order by created_at desc`,
        [groupId],
      );
      return {
        settings: settingsView(data),
        members: members.rows.map((m) => ({
          memberId: m.id,
          name: m.display_name,
          role: m.role,
          status: m.status,
          claimed: m.user_id !== null,
          username: m.username,
          startedOn: m.started_on,
        })),
        invites: invites.rows.map(toInvite),
        myRole: me.role,
      };
    });
    res.json(body);
  }));

  router.patch('/groups/:gid/settings', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const input = settingsSchema.parse(req.body);
    const user = currentUser(res);
    const body = await database.withUser(user.id, async (db) => {
      await requireAdmin(db, groupId, user.id);
      const before = await loadGroup(db, groupId);
      if (!before) throw notFound();
      await db.query(
        `update public.groups set
           name = coalesce($2, name),
           timezone = coalesce($3, timezone),
           reminder_time = coalesce($4::time, reminder_time),
           report_time = coalesce($5::time, report_time),
           reminders_enabled = coalesce($6, reminders_enabled),
           reports_enabled = coalesce($7, reports_enabled)
         where id = $1`,
        [groupId, input.name ?? null, input.timezone ?? null, input.reminderTime ?? null, input.reportTime ?? null, input.remindersEnabled ?? null, input.reportsEnabled ?? null],
      );
      if (input.dailyMinimum !== undefined && input.dailyMinimum !== before.dailyMinimum) {
        // Прошедшие дни сохраняют свою норму: добавляется новый период.
        await db.query(
          `insert into public.group_norms (group_id, effective_from, daily_minimum) values ($1, $2, $3)
           on conflict (group_id, effective_from) do update set daily_minimum = excluded.daily_minimum`,
          [groupId, before.today, input.dailyMinimum],
        );
      }
      const after = await loadGroup(db, groupId);
      return settingsView(after!);
    });
    res.json(body);
  }));

  router.post('/groups/:gid/invites', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const user = currentUser(res);
    const row = await database.withUser(user.id, async (db) => {
      await requireAdmin(db, groupId, user.id);
      const { rows } = await db.query(
        `insert into public.invites (group_id, code, created_by) values ($1, $2, $3)
         returning id, code, used_count, max_uses, expires_at, created_at`,
        [groupId, newCode(12), user.id],
      );
      return rows[0];
    });
    res.status(201).json(toInvite(row));
  }));

  router.delete('/groups/:gid/invites/:iid', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const inviteId = param(req, 'iid');
    const user = currentUser(res);
    await database.withUser(user.id, async (db) => {
      await requireAdmin(db, groupId, user.id);
      await db.query('update public.invites set revoked_at = now() where id = $1 and group_id = $2', [inviteId, groupId]);
    });
    res.status(204).end();
  }));

  router.post('/groups/:gid/members', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const input = addMemberSchema.parse(req.body);
    const user = currentUser(res);
    const memberId = await database.withUser(user.id, async (db) => {
      await requireAdmin(db, groupId, user.id);
      const { rows } = await db.query<{ id: string }>(
        'insert into public.group_members (group_id, display_name) values ($1, $2) returning id',
        [groupId, input.displayName],
      );
      return rows[0].id;
    });
    res.status(201).json({ memberId });
  }));

  router.patch('/groups/:gid/members/:mid', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const memberId = param(req, 'mid');
    const input = memberUpdateSchema.parse(req.body);
    const user = currentUser(res);
    await database.withUser(user.id, async (db) => {
      const me = await requireAdmin(db, groupId, user.id);
      const { rows } = await db.query<{ role: string; user_id: string | null }>(
        'select role, user_id from public.group_members where id = $1 and group_id = $2',
        [memberId, groupId],
      );
      const target = rows[0];
      if (!target) throw notFound('Участник не найден.');
      const changesAccess = input.status !== undefined || input.role !== undefined;
      if (changesAccess && target.role === 'owner') throw forbidden('Роль и статус владельца изменить нельзя.');
      if (changesAccess && target.role === 'admin' && me.role !== 'owner') throw forbidden('Других администраторов может менять только владелец.');
      if (input.role !== undefined && me.role !== 'owner') throw forbidden('Назначать администраторов может только владелец.');
      if (input.role === 'admin' && target.user_id === null) throw invalid('Участник ещё не подключился к приложению.');
      await db.query(
        `update public.group_members set
           status = coalesce($2, status),
           role = coalesce($3, role),
           started_on = coalesce($4::date, started_on),
           display_name = coalesce($5, display_name)
         where id = $1`,
        [memberId, input.status ?? null, input.role ?? null, input.startedOn ?? null, input.displayName ?? null],
      );
    });
    res.status(204).end();
  }));

  router.patch('/groups/:gid/members/:mid/pages-before', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const memberId = param(req, 'mid');
    const { pages } = pagesBeforeSchema.parse(req.body);
    const user = currentUser(res);
    const body = await database.withUser(user.id, async (db) => {
      const me = await requireMember(db, groupId, user.id);
      if (me.id !== memberId && !isAdmin(me)) throw forbidden('Изменить можно только своё значение.');
      await db.query('select app.set_pages_before($1::uuid, $2::uuid, $3::int)', [groupId, memberId, pages]);
      const data = await loadGroup(db, groupId);
      const target = data?.members.find((m) => m.member.id === memberId);
      if (!target) throw notFound('Участник не найден.');
      await syncAchievements(db, target);
      return { pagesBefore: target.stats.pagesBefore, totalPages: target.stats.totalPages };
    });
    res.json(body);
    void deps.notifications.flushAchievements().catch((e) => console.error('Очередь достижений', e));
  }));

  router.post('/groups/:gid/link-code', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const user = currentUser(res);
    const linkCode = newCode(4);
    await database.withUser(user.id, async (db) => {
      await requireAdmin(db, groupId, user.id);
      await db.query('update public.groups set link_code = $2 where id = $1', [groupId, linkCode]);
    });
    res.json({ linkCode });
  }));

  router.delete('/groups/:gid/chat', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const user = currentUser(res);
    await database.withUser(user.id, async (db) => {
      await requireAdmin(db, groupId, user.id);
      await db.query('update public.groups set telegram_chat_id = null, telegram_chat_title = null where id = $1', [groupId]);
    });
    res.status(204).end();
  }));

  router.post('/groups/:gid/publish-stats', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const user = currentUser(res);
    await database.withUser(user.id, (db) => requireAdmin(db, groupId, user.id));
    let sent: boolean;
    try {
      sent = await deps.notifications.publishStats(groupId);
    } catch (error) {
      if (error instanceof RecipientUnavailable) {
        throw new HttpError(409, 'chat_unavailable', 'Бот не может писать в этот чат. Проверьте, что он добавлен и ему разрешено отправлять сообщения.');
      }
      throw error;
    }
    if (!sent) throw new HttpError(409, 'chat_not_linked', 'Сначала подключите чат группы.');
    res.json({ sent });
  }));

  router.get('/groups/:gid/my-notifications', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const user = currentUser(res);
    const body = await database.withUser(user.id, async (db) => {
      const me = await requireMember(db, groupId, user.id);
      const data = await loadGroup(db, groupId);
      return notifications(db, me.id, data!.group);
    });
    res.json(body);
  }));

  router.patch('/groups/:gid/my-notifications', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const input = notificationsSchema.parse(req.body);
    const user = currentUser(res);
    const body = await database.withUser(user.id, async (db) => {
      const me = await requireMember(db, groupId, user.id);
      const current = await db.query('select reminder_time from public.member_settings where member_id = $1', [me.id]);
      const reminderTime = input.reminderTime === undefined ? (current.rows[0]?.reminder_time ?? null) : input.reminderTime;
      await db.query(
        `insert into public.member_settings (member_id, reminders_enabled, reminder_time, daily_report_enabled, achievements_enabled)
         values ($1, coalesce($2, true), $3::time, coalesce($4, true), coalesce($5, true))
         on conflict (member_id) do update set
           reminders_enabled = coalesce($2, member_settings.reminders_enabled),
           reminder_time = excluded.reminder_time,
           daily_report_enabled = coalesce($4, member_settings.daily_report_enabled),
           achievements_enabled = coalesce($5, member_settings.achievements_enabled)`,
        [me.id, input.remindersEnabled ?? null, reminderTime, input.dailyReportEnabled ?? null, input.achievementsEnabled ?? null],
      );
      const data = await loadGroup(db, groupId);
      return notifications(db, me.id, data!.group);
    });
    res.json(body);
  }));

  router.post('/groups/:gid/card', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const { imageBase64 } = cardSchema.parse(req.body);
    const user = currentUser(res);
    await database.withUser(user.id, (db) => requireMember(db, groupId, user.id));
    const image = Buffer.from(imageBase64, 'base64');
    if (image[0] !== 0xff || image[1] !== 0xd8) throw invalid('Ожидается изображение JPEG.');
    try {
      await deps.notifications.sendCard(user.telegramId, image);
    } catch (error) {
      if (error instanceof RecipientUnavailable) {
        throw new HttpError(409, 'bot_not_started', 'Откройте чат с ботом, нажмите «Запустить» и повторите.');
      }
      throw error;
    }
    res.json({ sent: true });
  }));
}
