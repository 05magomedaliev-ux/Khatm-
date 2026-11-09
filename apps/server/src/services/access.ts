import type { Db } from '../db.js';
import { forbidden } from '../http/errors.js';
import type { MemberRow } from './analytics.js';

export async function requireMember(db: Db, groupId: string, userId: string): Promise<MemberRow> {
  const { rows } = await db.query<MemberRow>(
    `select id, group_id, user_id, display_name, role, status, started_on
     from public.group_members where group_id = $1 and user_id = $2`,
    [groupId, userId],
  );
  const member = rows[0];
  if (!member || member.status !== 'active') throw forbidden('Вы не состоите в этой группе.');
  return member;
}

export function isAdmin(member: Pick<MemberRow, 'role'>): boolean {
  return member.role === 'owner' || member.role === 'admin';
}

export async function requireAdmin(db: Db, groupId: string, userId: string): Promise<MemberRow> {
  const member = await requireMember(db, groupId, userId);
  if (!isAdmin(member)) throw forbidden('Это действие доступно только администратору группы.');
  return member;
}
