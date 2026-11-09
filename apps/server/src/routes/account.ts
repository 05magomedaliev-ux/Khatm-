import { DEFAULT_TIMEZONE, localDate, type InvitePreview, type MeResponse, type MembershipView } from '@khatm/shared';
import type { Router } from 'express';
import type { Db } from '../db.js';
import type { Deps } from '../http/app.js';
import { forbidden, handle, HttpError, notFound } from '../http/errors.js';
import { createGroupSchema, inviteCode, joinSchema } from '../http/schemas.js';
import { currentUser } from '../http/telegramAuth.js';

interface InviteRow {
  id: string;
  group_id: string;
  group_name: string;
  timezone: string | null;
  max_uses: number | null;
  used_count: number;
  expires_at: Date | null;
  revoked_at: Date | null;
}

async function loadInvite(db: Db, code: string, lock: boolean): Promise<InviteRow> {
  const { rows } = await db.query<InviteRow>(
    `select i.id, i.group_id, i.max_uses, i.used_count, i.expires_at, i.revoked_at, g.name as group_name, g.timezone
     from public.invites i join public.groups g on g.id = i.group_id
     where i.code = $1 ${lock ? 'for update of i' : ''}`,
    [code],
  );
  const invite = rows[0];
  const expired = invite?.expires_at && new Date(invite.expires_at).getTime() < Date.now();
  const exhausted = invite?.max_uses !== null && invite?.max_uses !== undefined && invite.used_count >= invite.max_uses;
  if (!invite || invite.revoked_at || expired || exhausted) {
    throw notFound('Приглашение недействительно. Попросите организатора прислать новое.');
  }
  return invite;
}

export function accountRoutes(router: Router, { database }: Deps): void {
  router.get('/me', handle(async (_req, res) => {
    const user = currentUser(res);
    const memberships = await database.withUser(user.id, async (db) => {
      const { rows } = await db.query<{ group_id: string; group_name: string; id: string; display_name: string; role: MembershipView['role'] }>(
        `select m.id, m.group_id, m.display_name, m.role, g.name as group_name
         from public.group_members m join public.groups g on g.id = m.group_id
         where m.user_id = $1 and m.status = 'active'
         order by m.joined_at nulls last, g.created_at`,
        [user.id],
      );
      return rows;
    });
    const body: MeResponse = {
      user: { id: user.id, telegramId: user.telegramId, firstName: user.firstName, username: user.username, photoUrl: user.photoUrl },
      memberships: memberships.map((m) => ({
        groupId: m.group_id,
        groupName: m.group_name,
        memberId: m.id,
        displayName: m.display_name,
        role: m.role,
      })),
    };
    res.json(body);
  }));

  // Создание группы и вступление идут системной транзакцией: у пользователя ещё нет
  // членства, на которое могла бы опереться RLS. Проверки выполняются здесь явно.
  router.post('/groups', handle(async (req, res) => {
    const user = currentUser(res);
    const input = createGroupSchema.parse(req.body);
    const groupId = await database.withSystem(async (db) => {
      const today = localDate(input.timezone || DEFAULT_TIMEZONE);
      const { rows } = await db.query<{ id: string }>(
        'insert into public.groups (name, timezone, created_by) values ($1, $2, $3) returning id',
        [input.name, input.timezone, user.id],
      );
      const id = rows[0].id;
      await db.query('insert into public.group_norms (group_id, effective_from, daily_minimum) values ($1, $2, $3)', [id, today, input.dailyMinimum]);
      const member = await db.query<{ id: string }>(
        `insert into public.group_members (group_id, user_id, display_name, role, started_on, joined_at)
         values ($1, $2, $3, 'owner', $4, now()) returning id`,
        [id, user.id, input.displayName, today],
      );
      await db.query('insert into public.member_settings (member_id) values ($1)', [member.rows[0].id]);
      return id;
    });
    res.status(201).json({ groupId });
  }));

  router.get('/invites/:code', handle(async (req, res) => {
    const user = currentUser(res);
    const code = inviteCode(req);
    const preview = await database.withSystem(async (db): Promise<InvitePreview> => {
      const invite = await loadInvite(db, code, false);
      const members = await db.query<{ id: string; display_name: string; user_id: string | null; status: string }>(
        `select id, display_name, user_id, status from public.group_members where group_id = $1 order by created_at, id`,
        [invite.group_id],
      );
      const mine = members.rows.find((m) => m.user_id === user.id);
      if (mine?.status === 'blocked') throw forbidden('Доступ к этой группе ограничен администратором.');
      const active = members.rows.filter((m) => m.status === 'active');
      return {
        groupId: invite.group_id,
        groupName: invite.group_name,
        memberCount: active.length,
        alreadyMember: mine?.status === 'active',
        unclaimed: active.filter((m) => m.user_id === null).map((m) => ({ memberId: m.id, name: m.display_name })),
      };
    });
    res.json(preview);
  }));

  router.post('/invites/:code/join', handle(async (req, res) => {
    const user = currentUser(res);
    const code = inviteCode(req);
    const input = joinSchema.parse(req.body);
    const groupId = await database.withSystem(async (db) => {
      const invite = await loadInvite(db, code, true);
      const today = localDate(invite.timezone ?? DEFAULT_TIMEZONE);

      const existing = await db.query<{ id: string; status: string }>(
        'select id, status from public.group_members where group_id = $1 and user_id = $2 for update',
        [invite.group_id, user.id],
      );
      const current = existing.rows[0];
      if (current?.status === 'blocked') throw forbidden('Доступ к этой группе ограничен администратором.');
      if (current?.status === 'active') return invite.group_id;

      const owners = await db.query(`select 1 from public.group_members where group_id = $1 and role = 'owner' and status = 'active'`, [invite.group_id]);
      // Первый подключившийся к заранее созданной группе становится её владельцем.
      const role = owners.rows.length === 0 ? 'owner' : 'member';
      let memberId: string;

      if (current) {
        // Ранее удалённый участник возвращается со своей историей.
        await db.query(`update public.group_members set status = 'active', role = $2, joined_at = now() where id = $1`, [current.id, role]);
        memberId = current.id;
      } else if (input.memberId) {
        const claimed = await db.query<{ id: string }>(
          `update public.group_members
           set user_id = $1, role = $2, joined_at = now(), started_on = coalesce(started_on, $3)
           where id = $4 and group_id = $5 and user_id is null and status = 'active'
           returning id`,
          [user.id, role, today, input.memberId, invite.group_id],
        );
        if (!claimed.rows[0]) throw new HttpError(409, 'already_claimed', 'Это имя уже занято. Обновите список и выберите другое.');
        memberId = claimed.rows[0].id;
      } else {
        const created = await db.query<{ id: string }>(
          `insert into public.group_members (group_id, user_id, display_name, role, started_on, joined_at)
           values ($1, $2, $3, $4, $5, now()) returning id`,
          [invite.group_id, user.id, input.displayName, role, today],
        );
        memberId = created.rows[0].id;
      }

      await db.query('insert into public.member_settings (member_id) values ($1) on conflict do nothing', [memberId]);
      await db.query('update public.invites set used_count = used_count + 1 where id = $1', [invite.id]);
      return invite.group_id;
    });
    res.json({ groupId });
  }));
}
