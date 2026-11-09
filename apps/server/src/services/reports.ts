import {
  achievementByCode, ACHIEVEMENTS, achievementProgress, DUPLICATE_WINDOW_MINUTES, earnedAchievements, findRangeOverlaps,
  rangePages, type AchievementCode, type AchievementView, type ReportForOverlap, type ReportInput, type ReportView,
  type ReportWriteResponse, type RepeatWarningDetails,
} from '@khatm/shared';
import type { Db } from '../db.js';
import { HttpError, invalid, notFound, forbidden } from '../http/errors.js';
import { isAdmin } from './access.js';
import { loadGroup, type ComputedMember, type MemberRow } from './analytics.js';

interface ReportRow {
  id: string;
  group_id: string;
  member_id: string;
  member_name: string;
  kind: 'count' | 'range';
  pages: number;
  start_page: number | null;
  end_page: number | null;
  read_on: string;
  note: string | null;
  created_at: Date;
  updated_at: Date;
}

const REPORT_SELECT = `
  select r.id, r.group_id, r.member_id, m.display_name as member_name, r.kind, r.pages, r.start_page, r.end_page,
         r.read_on, r.note, r.created_at, r.updated_at
  from public.reports r
  join public.group_members m on m.id = r.member_id`;

export function toReportView(row: ReportRow, viewer: Pick<MemberRow, 'id' | 'role'>): ReportView {
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member_name,
    kind: row.kind,
    pages: row.pages,
    startPage: row.start_page,
    endPage: row.end_page,
    readOn: row.read_on,
    note: row.note,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    edited: new Date(row.updated_at).getTime() > new Date(row.created_at).getTime(),
    canEdit: isAdmin(viewer) || row.member_id === viewer.id,
  };
}

export async function listReports(
  db: Db,
  groupId: string,
  viewer: MemberRow,
  options: { memberId?: string; date?: string; limit?: number },
): Promise<ReportView[]> {
  const params: unknown[] = [groupId];
  let where = `r.group_id = $1 and r.deleted_at is null and m.status = 'active'`;
  if (options.memberId) {
    params.push(options.memberId);
    where += ` and r.member_id = $${params.length}`;
  }
  if (options.date) {
    params.push(options.date);
    where += ` and r.read_on = $${params.length}`;
  }
  params.push(options.limit ?? 50);
  const { rows } = await db.query<ReportRow>(
    `${REPORT_SELECT} where ${where} order by r.created_at desc limit $${params.length}`,
    params,
  );
  return rows.map((row) => toReportView(row, viewer));
}

async function getReport(db: Db, groupId: string, reportId: string): Promise<ReportRow> {
  const { rows } = await db.query<ReportRow>(
    `${REPORT_SELECT} where r.id = $1 and r.group_id = $2 and r.deleted_at is null`,
    [reportId, groupId],
  );
  if (!rows[0]) throw notFound('Отчёт не найден.');
  return rows[0];
}

/** Записи одного участника выполняются строго по очереди: проверка повторов и запись не разойдутся. */
async function lockMember(db: Db, memberId: string): Promise<void> {
  await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [memberId]);
}

async function memberReports(db: Db, memberId: string, excludeId?: string): Promise<ReportForOverlap[]> {
  const { rows } = await db.query<{
    id: string; kind: 'count' | 'range'; pages: number; start_page: number | null; end_page: number | null; read_on: string; created_at: Date;
  }>(
    `select id, kind, pages, start_page, end_page, read_on, created_at
     from public.reports where member_id = $1 and deleted_at is null`,
    [memberId],
  );
  return rows
    .filter((r) => r.id !== excludeId)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      pages: r.pages,
      startPage: r.start_page,
      endPage: r.end_page,
      readOn: r.read_on,
      createdAt: new Date(r.created_at).toISOString(),
    }));
}

function normalize(input: ReportInput) {
  if (input.kind === 'range') {
    const start = input.startPage!;
    const end = input.endPage!;
    return { kind: 'range' as const, pages: rangePages(start, end), start, end };
  }
  return { kind: 'count' as const, pages: input.pages!, start: null, end: null };
}

async function assertNoRepeat(
  db: Db,
  memberId: string,
  input: ReportInput,
  shape: ReturnType<typeof normalize>,
  excludeId?: string,
): Promise<void> {
  if (input.confirmRepeat) return;
  let details: RepeatWarningDetails | null = null;
  if (shape.kind === 'range') {
    const overlaps = findRangeOverlaps(shape.start!, shape.end!, await memberReports(db, memberId, excludeId));
    if (overlaps.length > 0) details = { reason: 'range_overlap', overlaps };
  } else if (!excludeId) {
    const { rows } = await db.query(
      `select 1 from public.reports
       where member_id = $1 and read_on = $2 and kind = 'count' and pages = $3 and deleted_at is null
         and created_at > now() - make_interval(mins => $4)
       limit 1`,
      [memberId, input.readOn, shape.pages, DUPLICATE_WINDOW_MINUTES],
    );
    if (rows.length > 0) details = { reason: 'possible_duplicate', overlaps: [] };
  }
  if (details) throw new HttpError(409, 'repeat_warning', 'Похоже, эти страницы уже учтены.', details);
}

function assertDateAllowed(readOn: string, today: string, startedOn: string | null): void {
  if (readOn > today) throw invalid('Нельзя внести отчёт за день, который ещё не наступил.', 'future_date');
  if (startedOn && readOn < startedOn) throw invalid('Эта дата раньше начала вашего учёта.', 'before_start');
}

/** Приводит таблицу достижений в соответствие с текущими отчётами. Возвращает новые. */
export async function syncAchievements(db: Db, target: ComputedMember): Promise<AchievementCode[]> {
  const earned = earnedAchievements({ reportCount: target.reportCount, stats: target.stats });
  const existing = await db.query<{ code: AchievementCode; revoked_at: Date | null }>(
    'select code, revoked_at from public.achievements where member_id = $1',
    [target.member.id],
  );
  const active = new Set(existing.rows.filter((r) => !r.revoked_at).map((r) => r.code));
  const fresh = earned.filter((code) => !active.has(code));

  for (const code of fresh) {
    await db.query(
      `insert into public.achievements (group_id, member_id, code)
       values ($1, $2, $3)
       on conflict (member_id, code) do update set revoked_at = null, earned_at = now()`,
      [target.member.group_id, target.member.id, code],
    );
  }
  const lost = [...active].filter((code) => !earned.includes(code));
  if (lost.length > 0) {
    await db.query(
      `update public.achievements set revoked_at = now() where member_id = $1 and code = any($2::text[])`,
      [target.member.id, lost],
    );
  }
  return fresh.filter((code) => achievementByCode(code));
}

async function finish(
  db: Db,
  groupId: string,
  memberId: string,
  readOn: string,
  row: ReportRow,
  viewer: MemberRow,
  duplicate: boolean,
): Promise<ReportWriteResponse> {
  const data = await loadGroup(db, groupId);
  const target = data?.members.find((m) => m.member.id === memberId);
  const newAchievements = target && !duplicate ? await syncAchievements(db, target) : [];
  return {
    report: toReportView(row, viewer),
    duplicate,
    day: target?.ledger.find((d) => d.date === readOn) ?? null,
    newAchievements,
  };
}

export async function createReport(
  db: Db,
  groupId: string,
  viewer: MemberRow,
  userId: string,
  input: ReportInput & { clientRequestId: string },
): Promise<ReportWriteResponse> {
  await lockMember(db, viewer.id);

  const existing = await db.query<ReportRow>(
    `${REPORT_SELECT} where r.member_id = $1 and r.client_request_id = $2`,
    [viewer.id, input.clientRequestId],
  );
  if (existing.rows[0]) {
    return finish(db, groupId, viewer.id, existing.rows[0].read_on, existing.rows[0], viewer, true);
  }

  const data = await loadGroup(db, groupId);
  if (!data) throw notFound('Группа не найдена.');
  assertDateAllowed(input.readOn, data.today, viewer.started_on);

  const shape = normalize(input);
  await assertNoRepeat(db, viewer.id, input, shape);

  const inserted = await db.query<{ id: string }>(
    `insert into public.reports
       (group_id, member_id, kind, pages, start_page, end_page, read_on, note, repeat_confirmed, client_request_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning id`,
    [groupId, viewer.id, shape.kind, shape.pages, shape.start, shape.end, input.readOn, input.note ?? null, !!input.confirmRepeat, input.clientRequestId, userId],
  );
  const row = await getReport(db, groupId, inserted.rows[0].id);
  return finish(db, groupId, viewer.id, input.readOn, row, viewer, false);
}

export async function updateReport(
  db: Db,
  groupId: string,
  viewer: MemberRow,
  reportId: string,
  input: ReportInput,
): Promise<ReportWriteResponse> {
  const current = await getReport(db, groupId, reportId);
  if (!isAdmin(viewer) && current.member_id !== viewer.id) throw forbidden('Изменить можно только свой отчёт.');
  await lockMember(db, current.member_id);

  const owner = await db.query<{ started_on: string | null }>('select started_on from public.group_members where id = $1', [current.member_id]);
  const data = await loadGroup(db, groupId);
  if (!data) throw notFound('Группа не найдена.');
  assertDateAllowed(input.readOn, data.today, owner.rows[0]?.started_on ?? null);

  const shape = normalize(input);
  await assertNoRepeat(db, current.member_id, input, shape, reportId);

  await db.query(
    `update public.reports
     set kind = $1, pages = $2, start_page = $3, end_page = $4, read_on = $5, note = $6,
         repeat_confirmed = repeat_confirmed or $7
     where id = $8 and deleted_at is null`,
    [shape.kind, shape.pages, shape.start, shape.end, input.readOn, input.note ?? null, !!input.confirmRepeat, reportId],
  );
  const row = await getReport(db, groupId, reportId);
  return finish(db, groupId, current.member_id, input.readOn, row, viewer, false);
}

export async function deleteReport(db: Db, groupId: string, viewer: MemberRow, reportId: string): Promise<void> {
  const current = await getReport(db, groupId, reportId);
  if (!isAdmin(viewer) && current.member_id !== viewer.id) throw forbidden('Удалить можно только свой отчёт.');
  await lockMember(db, current.member_id);
  await db.query('update public.reports set deleted_at = now() where id = $1 and deleted_at is null', [reportId]);
  const data = await loadGroup(db, groupId);
  const target = data?.members.find((m) => m.member.id === current.member_id);
  if (target) await syncAchievements(db, target);
}

export async function reportHistory(db: Db, groupId: string, reportId: string) {
  const { rows } = await db.query<{
    id: string; action: 'created' | 'updated' | 'deleted'; actor_name: string | null; created_at: Date; before: any; after: any;
  }>(
    `select e.id, e.action, e.created_at, e.before, e.after, u.first_name as actor_name
     from public.report_events e
     left join public.users u on u.id = e.actor_user_id
     where e.report_id = $1 and e.group_id = $2
     order by e.created_at, e.id`,
    [reportId, groupId],
  );
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorName: r.actor_name,
    createdAt: new Date(r.created_at).toISOString(),
    before: r.before,
    after: r.after,
  }));
}

export async function achievementViews(db: Db, member: ComputedMember): Promise<AchievementView[]> {
  const { rows } = await db.query<{ code: string; earned_at: Date }>(
    'select code, earned_at from public.achievements where member_id = $1 and revoked_at is null',
    [member.member.id],
  );
  const earned = new Map(rows.map((r) => [r.code, new Date(r.earned_at).toISOString()]));
  return ACHIEVEMENTS.map((def) => ({
    code: def.code,
    title: def.title,
    description: def.description,
    target: def.target,
    progress: achievementProgress(def, { reportCount: member.reportCount, stats: member.stats }),
    earnedAt: earned.get(def.code) ?? null,
  }));
}
