import {
  addDays, assignRanks, DEBT_CLEARED_VISIBLE_DAYS, monthDays, pickMotivation, type CalendarResponse, type DashboardResponse,
  type DayDetailResponse, type DisciplineResponse, type GroupView, type LeaderboardsResponse, type PersonRef, type ProfileResponse,
} from '@khatm/shared';
import type { Router } from 'express';
import type { Db } from '../db.js';
import type { Deps } from '../http/app.js';
import { handle, notFound } from '../http/errors.js';
import { isoDate, monthQuery, param } from '../http/schemas.js';
import { currentUser } from '../http/telegramAuth.js';
import { isAdmin, requireMember } from '../services/access.js';
import { loadGroup, progressOf, summarizeToday, type ComputedMember, type GroupData, type MemberRow } from '../services/analytics.js';
import { achievementViews, listReports } from '../services/reports.js';

const person = (m: ComputedMember): PersonRef => ({ memberId: m.member.id, name: m.member.display_name });

async function load(db: Db, groupId: string): Promise<GroupData> {
  const data = await loadGroup(db, groupId);
  if (!data) throw notFound('Группа не найдена.');
  return data;
}

function findMember(data: GroupData, memberId: string): ComputedMember {
  const found = data.members.find((m) => m.member.id === memberId);
  if (!found) throw notFound('Участник не найден.');
  return found;
}

function groupView(data: GroupData, me: MemberRow): GroupView {
  return {
    id: data.group.id,
    name: data.group.name,
    timezone: data.group.timezone,
    dailyMinimum: data.dailyMinimum,
    isAdmin: isAdmin(me),
    myMemberId: me.id,
  };
}

export function groupRoutes(router: Router, { database }: Deps): void {
  router.get('/groups/:gid/dashboard', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const user = currentUser(res);
    const body = await database.withUser(user.id, async (db): Promise<DashboardResponse> => {
      const me = await requireMember(db, groupId, user.id);
      const data = await load(db, groupId);
      const mine = findMember(data, me.id);
      const day = summarizeToday(data);
      return {
        group: groupView(data, me),
        progress: progressOf(data),
        today: {
          date: data.today,
          dailyMinimum: data.dailyMinimum,
          groupGoal: day.groupGoal,
          pages: day.pages,
          metCount: day.metCount,
          startedCount: day.startedCount,
          reportedCount: day.reportedCount,
          members: data.members.map((m) => ({ ...person(m), status: m.statusToday })),
        },
        me: { memberId: me.id, stats: mine.stats, startedOn: me.started_on },
        motivation: pickMotivation(mine.stats, `${data.today}:${me.id}`),
        recentReports: await listReports(db, groupId, me, { limit: 8 }),
      };
    });
    res.json(body);
  }));

  router.get('/groups/:gid/discipline', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const user = currentUser(res);
    const body = await database.withUser(user.id, async (db): Promise<DisciplineResponse> => {
      await requireMember(db, groupId, user.id);
      const data = await load(db, groupId);
      const day = summarizeToday(data);
      const yesterday = addDays(data.today, -1);
      const started = data.members.filter((m) => m.ledger.length > 0);

      const cleared: DisciplineResponse['cleared'] = [];
      for (const m of started) {
        if (m.stats.debt > 0) continue;
        const paidOff = m.ledger
          .slice(-DEBT_CLEARED_VISIBLE_DAYS)
          .reverse()
          .find((d) => d.debtBefore > 0 && d.debtAfter === 0);
        if (paidOff) cleared.push({ ...person(m), date: paidOff.date });
      }

      const best = Math.max(0, ...started.map((m) => m.stats.currentStreak));
      return {
        date: data.today,
        pagesToday: day.pages,
        groupGoal: day.groupGoal,
        met: started.filter((m) => m.stats.todayMet).map((m) => ({ ...person(m), pages: m.stats.today })),
        partial: started
          .filter((m) => !m.stats.todayMet && m.stats.today > 0)
          .map((m) => ({ ...person(m), pages: m.stats.today, norm: m.stats.todayNorm })),
        pending: started.filter((m) => m.stats.today === 0 && !m.stats.todayMet).map(person),
        notJoined: data.members.filter((m) => m.member.user_id === null).map(person),
        missedYesterday: started.filter((m) => m.ledger.find((d) => d.date === yesterday && !d.normMet)).map(person),
        debts: started.filter((m) => m.stats.debt > 0).map((m) => ({ ...person(m), debt: m.stats.debt })),
        cleared,
        longestStreak: best > 0 ? { days: best, people: started.filter((m) => m.stats.currentStreak === best).map(person) } : null,
      };
    });
    res.json(body);
  }));

  router.get('/groups/:gid/leaderboards', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const user = currentUser(res);
    const body = await database.withUser(user.id, async (db): Promise<LeaderboardsResponse> => {
      const me = await requireMember(db, groupId, user.id);
      const data = await load(db, groupId);

      const pagesRanked = assignRanks(
        data.members.filter((m) => m.stats.totalPages > 0).sort((a, b) => b.stats.totalPages - a.stats.totalPages),
        (m) => m.stats.totalPages,
      );
      const pagesRow = (m: ComputedMember, rank: number | null) => ({
        ...person(m),
        rank,
        totalPages: m.stats.totalPages,
        percent: m.stats.percent,
        isMe: m.member.id === me.id,
      });

      const disciplineRanked = assignRanks(
        data.members.filter((m) => m.discipline.score !== null).sort((a, b) => b.discipline.score! - a.discipline.score!),
        (m) => m.discipline.score!,
      );
      const disciplineRow = (m: ComputedMember, rank: number | null) => ({
        ...person(m),
        ...m.discipline,
        rank,
        isMe: m.member.id === me.id,
      });

      // Участники без данных показываются без места: рейтинг им не присваивается.
      return {
        pages: [
          ...pagesRanked.map((m) => pagesRow(m, m.rank)),
          ...data.members.filter((m) => m.stats.totalPages === 0).map((m) => pagesRow(m, null)),
        ],
        discipline: [
          ...disciplineRanked.map((m) => disciplineRow(m, m.rank)),
          ...data.members.filter((m) => m.discipline.score === null).map((m) => disciplineRow(m, null)),
        ],
      };
    });
    res.json(body);
  }));

  router.get('/groups/:gid/members/:mid/profile', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const memberId = param(req, 'mid');
    const user = currentUser(res);
    const body = await database.withUser(user.id, async (db): Promise<ProfileResponse> => {
      const me = await requireMember(db, groupId, user.id);
      const data = await load(db, groupId);
      const target = findMember(data, memberId);
      return {
        member: {
          ...person(target),
          role: target.member.role,
          startedOn: target.member.started_on,
          photoUrl: target.member.photo_url ?? null,
          isMe: target.member.id === me.id,
        },
        today: data.today,
        stats: target.stats,
        series: target.ledger.slice(-120).map((d) => ({ date: d.date, pages: d.pages, norm: d.norm, status: d.status })),
        achievements: await achievementViews(db, target),
        motivation: pickMotivation(target.stats, `${data.today}:${target.member.id}`),
      };
    });
    res.json(body);
  }));

  router.get('/groups/:gid/members/:mid/calendar', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const memberId = param(req, 'mid');
    const { month } = monthQuery.parse(req.query);
    const user = currentUser(res);
    const body = await database.withUser(user.id, async (db): Promise<CalendarResponse> => {
      await requireMember(db, groupId, user.id);
      const data = await load(db, groupId);
      const target = findMember(data, memberId);
      const byDate = new Map(target.ledger.map((d) => [d.date, d]));
      return {
        month,
        today: data.today,
        startedOn: target.member.started_on,
        member: person(target),
        members: data.members.filter((m) => m.member.user_id !== null).map(person),
        days: monthDays(month).map((date) => {
          const entry = byDate.get(date);
          return {
            date,
            pages: entry?.pages ?? 0,
            norm: entry?.norm ?? null,
            status: entry?.status ?? 'none',
            provisional: entry?.provisional ?? false,
          };
        }),
      };
    });
    res.json(body);
  }));

  router.get('/groups/:gid/members/:mid/days/:date', handle(async (req, res) => {
    const groupId = param(req, 'gid');
    const memberId = param(req, 'mid');
    const date = isoDate.parse(req.params.date);
    const user = currentUser(res);
    const body = await database.withUser(user.id, async (db): Promise<DayDetailResponse> => {
      const me = await requireMember(db, groupId, user.id);
      const data = await load(db, groupId);
      const target = findMember(data, memberId);
      const entries = data.members.map((m) => m.ledger.find((d) => d.date === date)).filter((d) => d !== undefined);
      return {
        date,
        member: person(target),
        entry: target.ledger.find((d) => d.date === date) ?? null,
        reports: await listReports(db, groupId, me, { memberId, date, limit: 100 }),
        groupPages: entries.reduce((sum, d) => sum + d.pages, 0),
        groupMet: entries.filter((d) => d.normMet).length,
        groupStarted: entries.length,
      };
    });
    res.json(body);
  }));
}
