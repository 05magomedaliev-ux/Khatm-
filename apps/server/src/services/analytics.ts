import {
  buildLedger, computeDiscipline, computeStats, groupProgress, localDate, type DayStatus,
  type DisciplineScore, type LedgerDay, type MemberRole, type MemberStats, type MemberStatus, type NormPeriod,
} from '@khatm/shared';
import type { Db } from '../db.js';

export interface GroupRow {
  id: string;
  name: string;
  timezone: string;
  reminder_time: string;
  report_time: string;
  reminders_enabled: boolean;
  reports_enabled: boolean;
  telegram_chat_id: number | null;
  telegram_chat_title: string | null;
  telegram_thread_id: number | null;
  link_code: string | null;
}

export interface MemberRow {
  id: string;
  group_id: string;
  user_id: string | null;
  display_name: string;
  role: MemberRole;
  status: MemberStatus;
  started_on: string | null;
  pages_before: number;
  username?: string | null;
  photo_url?: string | null;
}

export interface ComputedMember {
  member: MemberRow;
  ledger: LedgerDay[];
  stats: MemberStats;
  discipline: DisciplineScore;
  reportCount: number;
  statusToday: DayStatus | 'not_joined';
}

export interface GroupData {
  group: GroupRow;
  norms: NormPeriod[];
  today: string;
  dailyMinimum: number;
  members: ComputedMember[];
}

export async function loadGroup(db: Db, groupId: string, now: Date = new Date()): Promise<GroupData | null> {
  const groups = await db.query<GroupRow>('select * from public.groups where id = $1', [groupId]);
  const group = groups.rows[0];
  if (!group) return null;

  const norms = (
    await db.query<{ effective_from: string; daily_minimum: number }>(
      'select effective_from, daily_minimum from public.group_norms where group_id = $1 order by effective_from',
      [groupId],
    )
  ).rows.map((r) => ({ effectiveFrom: r.effective_from, dailyMinimum: r.daily_minimum }));

  const memberRows = (
    await db.query<MemberRow>(
      `select m.id, m.group_id, m.user_id, m.display_name, m.role, m.status, m.started_on, m.pages_before, u.username, u.photo_url
       from public.group_members m
       left join public.users u on u.id = m.user_id
       where m.group_id = $1 and m.status = 'active'
       order by m.created_at, m.id`,
      [groupId],
    )
  ).rows;

  const dayRows = (
    await db.query<{ member_id: string; read_on: string; pages: number; reports: number }>(
      `select member_id, read_on, sum(pages)::int as pages, count(*)::int as reports
       from public.reports
       where group_id = $1 and deleted_at is null
       group by member_id, read_on`,
      [groupId],
    )
  ).rows;

  const pagesByMember = new Map<string, Record<string, number>>();
  const reportCounts = new Map<string, number>();
  for (const row of dayRows) {
    const pages = pagesByMember.get(row.member_id) ?? {};
    pages[row.read_on] = row.pages;
    pagesByMember.set(row.member_id, pages);
    reportCounts.set(row.member_id, (reportCounts.get(row.member_id) ?? 0) + row.reports);
  }

  const today = localDate(group.timezone, now);
  const members = memberRows.map((member): ComputedMember => {
    const ledger = member.started_on
      ? buildLedger({ startDate: member.started_on, today, pagesByDate: pagesByMember.get(member.id) ?? {}, norms })
      : [];
    const todayEntry = ledger.find((d) => d.date === today);
    return {
      member,
      ledger,
      stats: computeStats(ledger, today, member.pages_before),
      discipline: computeDiscipline(ledger),
      reportCount: reportCounts.get(member.id) ?? 0,
      statusToday: member.user_id === null ? 'not_joined' : (todayEntry?.status ?? 'none'),
    };
  });

  const dailyMinimum = [...norms].reverse().find((n) => n.effectiveFrom <= today)?.dailyMinimum ?? norms[0]?.dailyMinimum ?? 0;
  return { group, norms, today, dailyMinimum, members };
}

export interface GroupDaySummary {
  pages: number;
  metCount: number;
  reportedCount: number;
  startedCount: number;
  groupGoal: number;
}

export function summarizeToday(data: GroupData): GroupDaySummary {
  const started = data.members.filter((m) => m.ledger.some((d) => d.date === data.today));
  return {
    pages: data.members.reduce((sum, m) => sum + m.stats.today, 0),
    metCount: started.filter((m) => m.stats.todayMet).length,
    reportedCount: started.filter((m) => m.stats.today > 0).length,
    startedCount: started.length,
    groupGoal: data.dailyMinimum * data.members.length,
  };
}

export function progressOf(data: GroupData) {
  return groupProgress(data.members.map((m) => m.stats.totalPages));
}
