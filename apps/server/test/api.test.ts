/**
 * Сквозной сценарий на пятерых участниках поверх настоящей базы.
 * Запуск: TEST_DATABASE_URL=postgres://... npm test (база с применёнными миграциями).
 */
import { addDays, localDate } from '@khatm/shared';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { validateInitData } from '../src/http/telegramAuth.js';
import { RecipientUnavailable } from '../src/services/messenger.js';
import { BOT_TOKEN, client, signInitData, startHarness, telegramIdBase, type Client, type Harness } from './helpers.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const NAMES = ['Мурад', 'Курбан', 'Закария', 'Мухаммад', 'Марат'];

describe('Хатм: пять участников', { skip: !DATABASE_URL }, () => {
  let h: Harness;
  let groupId: string;
  let invite: string;
  let members: Client[];
  let outsider: Client;
  const memberIds: Record<string, string> = {};
  const today = localDate('Europe/Moscow');
  const report = (input: object) => ({ clientRequestId: randomUUID(), readOn: today, ...input });

  before(async () => {
    h = await startHarness(DATABASE_URL!);
    const base = telegramIdBase();
    members = NAMES.map((name, i) => client(h.url, base + i, name));
    outsider = client(h.url, base + 100, 'Гость');
    invite = randomUUID().replaceAll('-', '');
    await h.database.withSystem(async (db) => {
      const { rows } = await db.query<{ id: string }>(`insert into public.groups (name) values ('Хатм — наш путь') returning id`);
      groupId = rows[0].id;
      await db.query(`insert into public.group_norms (group_id, effective_from, daily_minimum) values ($1, '2020-01-01', 2)`, [groupId]);
      for (const name of NAMES) {
        const m = await db.query<{ id: string }>('insert into public.group_members (group_id, display_name) values ($1, $2) returning id', [groupId, name]);
        memberIds[name] = m.rows[0].id;
      }
      await db.query('insert into public.invites (group_id, code) values ($1, $2)', [groupId, invite]);
    });
  });

  after(async () => {
    await h.close();
  });

  test('авторизация: подпись initData проверяется на сервере', async () => {
    const call = (authorization?: string) =>
      fetch(`${h.url}/api/me`, { headers: authorization ? { Authorization: authorization } : {} }).then((r) => r.status);
    const good = signInitData({ id: 42, first_name: 'Тест' });
    assert.equal(await call(), 401);
    assert.equal(await call(`tma ${good.replace('first_name', 'first_namE')}`), 401);
    assert.equal(await call(`tma ${signInitData({ id: 42, first_name: 'Тест' }, undefined, '9:other-token')}`), 401);
    assert.equal(await call(`tma ${signInitData({ id: 42, first_name: 'Тест' }, Math.floor(Date.now() / 1000) - 90_000)}`), 401);
    assert.equal(await call(`tma ${good}`), 200);
    assert.equal(validateInitData('user=%7B%7D&auth_date=1&hash=abc', BOT_TOKEN, 100), null);
  });

  test('участники подключаются по приглашению и выбирают свои имена', async () => {
    const preview = await members[0].call('GET', `/invites/${invite}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.unclaimed.length, 5);
    assert.equal(preview.body.memberCount, 5);

    for (let i = 0; i < 5; i += 1) {
      const joined = await members[i].call('POST', `/invites/${invite}/join`, { memberId: memberIds[NAMES[i]] });
      assert.equal(joined.status, 200);
    }
    const stolen = await outsider.call('POST', `/invites/${invite}/join`, { memberId: memberIds['Марат'] });
    assert.equal(stolen.status, 409);

    const me = await members[0].call('GET', '/me');
    assert.equal(me.body.memberships[0].role, 'owner');
    const second = await members[1].call('GET', '/me');
    assert.equal(second.body.memberships[0].role, 'member');
  });

  test('старт с нуля: ничего выдуманного, цель 3020, рейтингов нет', async () => {
    const d = (await members[0].call('GET', `/groups/${groupId}/dashboard`)).body;
    assert.equal(d.progress.memberCount, 5);
    assert.equal(d.progress.goalPages, 3020);
    assert.equal(d.progress.totalPages, 0);
    assert.equal(d.progress.percent, 0);
    assert.equal(d.recentReports.length, 0);
    assert.equal(d.today.metCount, 0);
    assert.equal(d.today.startedCount, 5);
    assert.equal(d.today.groupGoal, 10);
    assert.equal(d.me.stats.debt, 0);

    const l = (await members[0].call('GET', `/groups/${groupId}/leaderboards`)).body;
    assert.ok(l.pages.every((r: any) => r.rank === null));
    assert.ok(l.discipline.every((r: any) => r.rank === null && r.score === null));
  });

  test('чужой не видит группу', async () => {
    const r = await outsider.call('GET', `/groups/${groupId}/dashboard`);
    assert.equal(r.status, 403);
  });

  test('два способа внесения, несколько отчётов за день, включительный диапазон', async () => {
    const a = await members[0].call('POST', `/groups/${groupId}/reports`, report({ kind: 'count', pages: 1 }));
    assert.equal(a.status, 201);
    assert.equal(a.body.report.pages, 1);
    assert.equal(a.body.day.status, 'partial');
    assert.deepEqual(a.body.newAchievements, ['first_report']);

    const b = await members[0].call('POST', `/groups/${groupId}/reports`, report({ kind: 'range', startPage: 20, endPage: 25 }));
    assert.equal(b.status, 201);
    assert.equal(b.body.report.pages, 6);
    assert.equal(b.body.day.pages, 7);
    assert.equal(b.body.day.status, 'met');
    assert.equal(b.body.day.surplus, 5);
  });

  test('проверки ввода', async () => {
    const post = (input: object) => members[1].call('POST', `/groups/${groupId}/reports`, report(input));
    assert.equal((await post({ kind: 'count', pages: 0 })).status, 422);
    assert.equal((await post({ kind: 'count', pages: 605 })).status, 422);
    assert.equal((await post({ kind: 'range', startPage: 30, endPage: 20 })).status, 422);
    assert.equal((await post({ kind: 'range', startPage: 600, endPage: 605 })).status, 422);
    assert.equal((await post({ kind: 'count', pages: 2, readOn: addDays(today, 1) })).body.error.code, 'future_date');
    assert.equal((await post({ kind: 'count', pages: 2, readOn: addDays(today, -40) })).body.error.code, 'before_start');
  });

  test('защита от двойной отправки', async () => {
    const id = randomUUID();
    const body = { clientRequestId: id, kind: 'count', pages: 3, readOn: today };
    const results = await Promise.all([1, 2, 3, 4].map(() => members[2].call('POST', `/groups/${groupId}/reports`, body)));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 200 && r.body.duplicate).length, 3);
    const list = (await members[2].call('GET', `/groups/${groupId}/reports?member_id=${memberIds['Закария']}`)).body.reports;
    assert.equal(list.length, 1);
  });

  test('пересечения диапазонов и явное разделение режимов', async () => {
    const post = (input: object) => members[3].call('POST', `/groups/${groupId}/reports`, report(input));
    assert.equal((await post({ kind: 'range', startPage: 100, endPage: 110 })).status, 201);

    const overlap = await post({ kind: 'range', startPage: 110, endPage: 112 });
    assert.equal(overlap.status, 409);
    assert.equal(overlap.body.error.code, 'repeat_warning');
    assert.equal(overlap.body.error.details.reason, 'range_overlap');
    assert.equal(overlap.body.error.details.overlaps[0].overlapStart, 110);

    assert.equal((await post({ kind: 'range', startPage: 111, endPage: 112 })).status, 201);
    assert.equal((await post({ kind: 'range', startPage: 100, endPage: 101, confirmRepeat: true })).status, 201);

    // Отчёт-количество не содержит страниц: с диапазоном он не сверяется и пересечением не считается.
    assert.equal((await post({ kind: 'count', pages: 11 })).status, 201);
    const twin = await post({ kind: 'count', pages: 11 });
    assert.equal(twin.status, 409);
    assert.equal(twin.body.error.details.reason, 'possible_duplicate');
  });

  test('пример из ТЗ: пн 2, вт 0, ср 4 даёт долг 0; статусы и календарь', async () => {
    const m = members[4];
    const id = memberIds['Марат'];
    const start = addDays(today, -3);
    assert.equal((await members[0].call('PATCH', `/groups/${groupId}/members/${id}`, { startedOn: start })).status, 204);

    await m.call('POST', `/groups/${groupId}/reports`, report({ kind: 'count', pages: 2, readOn: start }));
    const wed = addDays(start, 2);
    await m.call('POST', `/groups/${groupId}/reports`, report({ kind: 'count', pages: 4, readOn: wed }));

    const day = (date: string) => m.call('GET', `/groups/${groupId}/members/${id}/days/${date}`).then((r) => r.body.entry);
    const tue = await day(addDays(start, 1));
    assert.equal(tue.debtAfter, 2);
    assert.equal(tue.status, 'missed');
    const w = await day(wed);
    assert.equal(w.paidDebt, 2);
    assert.equal(w.appliedToNorm, 2);
    assert.equal(w.debtAfter, 0);
    assert.equal(w.status, 'met');

    const cal = (await m.call('GET', `/groups/${groupId}/members/${id}/calendar?month=${today.slice(0, 7)}`)).body;
    const todayCell = cal.days.find((d: any) => d.date === today);
    assert.equal(todayCell.status, 'none');
    assert.equal(todayCell.provisional, true);

    const p = (await m.call('GET', `/groups/${groupId}/members/${id}/profile`)).body;
    assert.equal(p.stats.debt, 0);
    assert.equal(p.stats.totalPages, 6);
    assert.equal(p.stats.completedDays, 2);
    assert.equal(p.stats.bestDay.pages, 4);
    assert.ok(p.stats.forecastDate);
  });

  test('правка и удаление задним числом пересчитывают долг, история сохраняется', async () => {
    const m = members[4];
    const id = memberIds['Марат'];
    const start = addDays(today, -3);
    const wed = addDays(start, 2);
    const created = await m.call('POST', `/groups/${groupId}/reports`, report({ kind: 'range', startPage: 300, endPage: 301, readOn: wed }));
    const rid = created.body.report.id;

    const edited = await m.call('PATCH', `/groups/${groupId}/reports/${rid}`, { kind: 'range', startPage: 300, endPage: 303, readOn: wed });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.report.pages, 4);
    assert.equal(edited.body.report.edited, true);
    assert.equal(edited.body.duplicate, false);

    assert.equal((await members[1].call('DELETE', `/groups/${groupId}/reports/${rid}`)).status, 403);
    assert.equal((await members[1].call('PATCH', `/groups/${groupId}/reports/${rid}`, { kind: 'count', pages: 1, readOn: wed })).status, 403);

    assert.equal((await m.call('DELETE', `/groups/${groupId}/reports/${rid}`)).status, 204);
    assert.equal((await m.call('DELETE', `/groups/${groupId}/reports/${rid}`)).status, 404);

    const history = (await m.call('GET', `/groups/${groupId}/reports/${rid}/history`)).body.events;
    assert.deepEqual(history.map((e: any) => e.action), ['created', 'updated', 'deleted']);
    assert.equal(history[1].before.endPage, 301);
    assert.equal(history[1].after.endPage, 303);
    assert.equal(history[1].actorName, 'Марат');

    const p = (await m.call('GET', `/groups/${groupId}/members/${id}/profile`)).body;
    assert.equal(p.stats.totalPages, 6);
  });

  test('администратор управляет чужими отчётами', async () => {
    const created = await members[1].call('POST', `/groups/${groupId}/reports`, report({ kind: 'count', pages: 2 }));
    const rid = created.body.report.id;
    const fixed = await members[0].call('PATCH', `/groups/${groupId}/reports/${rid}`, { kind: 'count', pages: 4, readOn: today });
    assert.equal(fixed.status, 200);
    assert.equal(fixed.body.report.memberId, memberIds['Курбан']);
    assert.equal(fixed.body.report.pages, 4);
  });

  test('рейтинги: сортировка, равенство, сегодняшний день не влияет на дисциплину', async () => {
    const l = (await members[0].call('GET', `/groups/${groupId}/leaderboards`)).body;
    assert.deepEqual(l.pages.map((r: any) => r.totalPages), [...l.pages.map((r: any) => r.totalPages)].sort((a: number, b: number) => b - a));
    assert.equal(l.pages[0].rank, 1);

    const marat = l.discipline.find((r: any) => r.name === 'Марат');
    assert.equal(marat.closedDays, 3);
    assert.equal(marat.completion, 66.7);
    assert.equal(marat.closedStreak, 1);
    assert.equal(marat.debtScore, 100);
    assert.equal(marat.score, Math.round((0.7 * (200 / 3) + 0.2 * (100 / 30) + 10) * 10) / 10);
    const murad = l.discipline.find((r: any) => r.name === 'Мурад');
    assert.equal(murad.rank, null);
    assert.equal(murad.score, null);
  });

  test('дисциплина группы', async () => {
    const d = (await members[1].call('GET', `/groups/${groupId}/discipline`)).body;
    assert.ok(d.met.some((p: any) => p.name === 'Мурад'));
    assert.ok(d.pending.some((p: any) => p.name === 'Марат'));
    assert.equal(d.notJoined.length, 0);
    assert.ok(d.cleared.some((p: any) => p.name === 'Марат'));
    assert.equal(d.pagesToday, d.met.concat(d.partial).reduce((s: number, p: any) => s + p.pages, 0));
  });

  test('норма меняется только вперёд', async () => {
    const before = (await members[0].call('GET', `/groups/${groupId}/members/${memberIds['Марат']}/days/${addDays(today, -1)}`)).body.entry;
    assert.equal(before.norm, 2);
    assert.equal((await members[1].call('PATCH', `/groups/${groupId}/settings`, { dailyMinimum: 3 })).status, 403);
    assert.equal((await members[0].call('PATCH', `/groups/${groupId}/settings`, { dailyMinimum: 3 })).body.dailyMinimum, 3);
    const later = (await members[0].call('GET', `/groups/${groupId}/members/${memberIds['Марат']}/days/${addDays(today, -1)}`)).body.entry;
    assert.equal(later.norm, 2);
    const now = (await members[0].call('GET', `/groups/${groupId}/members/${memberIds['Марат']}/days/${today}`)).body.entry;
    assert.equal(now.norm, 3);
    await members[0].call('PATCH', `/groups/${groupId}/settings`, { dailyMinimum: 2 });
  });

  test('RLS защищает данные независимо от кода маршрутов', async () => {
    const outsiderUser = (await outsider.call('GET', '/me')).body.user.id as string;
    const memberUser = (await members[1].call('GET', '/me')).body.user.id as string;

    const seen = await h.database.withUser(outsiderUser, async (db) => ({
      reports: (await db.query('select id from public.reports where group_id = $1', [groupId])).rows.length,
      groups: (await db.query('select id from public.groups where id = $1', [groupId])).rows.length,
      invites: (await db.query('select id from public.invites where group_id = $1', [groupId])).rows.length,
    }));
    assert.deepEqual(seen, { reports: 0, groups: 0, invites: 0 });

    // Рядовой участник не может повысить себя и не видит приглашения.
    const escalation = await h.database.withUser(memberUser, async (db) => ({
      updated: (await db.query(`update public.group_members set role = 'owner' where user_id = $1`, [memberUser])).rowCount,
      invites: (await db.query('select id from public.invites where group_id = $1', [groupId])).rows.length,
    }));
    assert.deepEqual(escalation, { updated: 0, invites: 0 });

    await assert.rejects(
      h.database.withUser(memberUser, (db) => db.query(`insert into public.reports (group_id, member_id, kind, pages, read_on, client_request_id) values ($1, $2, 'count', 5, $3, $4)`, [groupId, memberIds['Мурад'], today, randomUUID()])),
      /row-level security/,
    );
    await assert.rejects(
      h.database.withUser(memberUser, (db) => db.query('select * from public.notification_log')),
      /permission denied/,
    );
    await assert.rejects(
      h.database.withUser(memberUser, (db) => db.query('delete from public.reports')),
      /permission denied/,
    );
    await assert.rejects(
      h.database.withUser(memberUser, (db) => db.query(`insert into public.report_events (report_id, group_id, action) select id, group_id, 'created' from public.reports limit 1`)),
      /permission denied/,
    );
  });

  test('уведомления о достижениях уходят один раз', async () => {
    await h.notifications.flushAchievements();
    const count = h.messenger.sent.length;
    assert.ok(h.messenger.sent.some((m) => m.html.includes('Первый отчёт') && m.chatId === members[0].tgId));
    await h.notifications.flushAchievements();
    assert.equal(h.messenger.sent.length, count);
  });

  test('напоминания: только тем, кто не выполнил норму, по времени группы, один раз', async () => {
    h.messenger.sent.length = 0;
    await h.database.withSystem((db) => db.query(`update public.groups set reminder_time = '00:00', report_time = '00:00' where id = $1`, [groupId]));
    const now = new Date(`${today}T12:00:00+03:00`);
    const noon = new Date(`${today}T00:30:00+03:00`);
    await h.notifications.tick(noon);
    const reminders = h.messenger.sent.filter((m) => m.html.startsWith('Сегодня осталось'));
    assert.ok(reminders.some((m) => m.chatId === members[4].tgId), 'Марат ещё не читал сегодня');
    assert.ok(!reminders.some((m) => m.chatId === members[0].tgId), 'Мурад уже выполнил норму');
    assert.equal(reminders[0].button?.webAppUrl, 'https://example.test/app');

    const reports = h.messenger.sent.filter((m) => m.html.includes('Итоги дня'));
    assert.equal(reports.length, 5, 'чат не подключён: итоги приходят в личные сообщения');
    assert.ok(!reports[0].html.includes('Марат'), 'итоги не называют тех, кто не выполнил норму');

    const total = h.messenger.sent.length;
    await h.notifications.tick(noon);
    assert.equal(h.messenger.sent.length, total);

    await h.database.withSystem((db) => db.query('delete from public.notification_log where group_id = $1', [groupId]));
    h.messenger.sent.length = 0;
    await h.notifications.tick(now);
    assert.equal(h.messenger.sent.length, 0, 'вне окна рассылки ничего не отправляется');
  });

  test('заблокировавший бота больше не получает сообщений', async () => {
    await h.database.withSystem((db) => db.query('delete from public.notification_log where group_id = $1', [groupId]));
    const original = h.messenger.send.bind(h.messenger);
    const blockedId = members[4].tgId;
    h.messenger.send = async (chatId, html, button) => {
      if (chatId === blockedId) throw new RecipientUnavailable('blocked');
      return original(chatId, html, button);
    };
    await h.notifications.tick(new Date(`${today}T00:30:00+03:00`));
    h.messenger.send = original;
    const flagged = await h.database.withSystem(async (db) => (await db.query('select bot_blocked from public.users where telegram_id = $1', [blockedId])).rows[0].bot_blocked);
    assert.equal(flagged, true);
    await h.database.withSystem((db) => db.query('update public.users set bot_blocked = false where telegram_id = $1', [blockedId]));
  });

  test('персональные настройки уведомлений', async () => {
    const path = `/groups/${groupId}/my-notifications`;
    assert.equal((await members[1].call('GET', path)).body.remindersEnabled, true);
    const off = (await members[1].call('PATCH', path, { remindersEnabled: false, reminderTime: '07:30' })).body;
    assert.equal(off.remindersEnabled, false);
    assert.equal(off.reminderTime, '07:30');
    assert.equal((await members[1].call('PATCH', path, { remindersEnabled: true })).body.reminderTime, '07:30');
    assert.equal((await members[1].call('PATCH', path, { reminderTime: null })).body.reminderTime, null);
    assert.equal((await members[1].call('PATCH', path, { reminderTime: '25:00' })).status, 422);
  });

  test('карточка отправляется в личный чат', async () => {
    const path = `/groups/${groupId}/card`;
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 1)]).toString('base64');
    assert.equal((await members[0].call('POST', path, { imageBase64: jpeg })).status, 200);
    assert.equal(h.messenger.photos[0].chatId, members[0].tgId);
    assert.equal((await members[0].call('POST', path, { imageBase64: Buffer.alloc(200, 1).toString('base64') })).status, 422);
    assert.equal((await outsider.call('POST', path, { imageBase64: jpeg })).status, 403);
  });

  test('приглашения: администратор создаёт и отключает, участник не может', async () => {
    assert.equal((await members[1].call('POST', `/groups/${groupId}/invites`, {})).status, 403);
    const created = (await members[0].call('POST', `/groups/${groupId}/invites`, {})).body;
    assert.match(created.link, /^https:\/\/t\.me\/khatm_test_bot\?start=/);
    assert.equal((await members[0].call('DELETE', `/groups/${groupId}/invites/${created.id}`)).status, 204);
    assert.equal((await outsider.call('GET', `/invites/${created.code}`)).status, 404);
  });

  test('страницы до начала учёта: только свои, входят в итог, не трогают дисциплину', async () => {
    const id = memberIds['Закария'];
    const path = `/groups/${groupId}/members/${id}/pages-before`;
    const before = (await members[2].call('GET', `/groups/${groupId}/members/${id}/profile`)).body.stats;
    const scoreBefore = (await members[2].call('GET', `/groups/${groupId}/leaderboards`)).body.discipline.find((r: any) => r.name === 'Закария');

    assert.equal((await members[1].call('PATCH', path, { pages: 50 })).status, 403, 'чужое значение менять нельзя');
    assert.equal((await members[2].call('PATCH', path, { pages: 605 })).status, 422);
    assert.equal((await outsider.call('PATCH', path, { pages: 1 })).status, 403);

    const saved = await members[2].call('PATCH', path, { pages: 120 });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.totalPages, before.totalPages + 120);

    const after = (await members[2].call('GET', `/groups/${groupId}/members/${id}/profile`)).body;
    assert.equal(after.stats.pagesBefore, 120);
    assert.equal(after.stats.remaining, before.remaining - 120);
    assert.equal(after.stats.averagePace, before.averagePace);
    assert.equal(after.stats.debt, before.debt);
    assert.equal(after.stats.currentStreak, before.currentStreak);
    assert.equal(after.stats.bestDay.pages, before.bestDay.pages);
    assert.ok(after.achievements.find((a: any) => a.code === 'pages_100').earnedAt, 'достижение учитывает прочитанное');

    const scoreAfter = (await members[2].call('GET', `/groups/${groupId}/leaderboards`)).body.discipline.find((r: any) => r.name === 'Закария');
    assert.equal(scoreAfter.score, scoreBefore.score);

    const total = (await members[0].call('GET', `/groups/${groupId}/dashboard`)).body.progress.totalPages;
    assert.equal((await members[0].call('PATCH', path, { pages: 0 })).status, 200, 'администратор может исправить');
    assert.equal((await members[0].call('GET', `/groups/${groupId}/dashboard`)).body.progress.totalPages, total - 120);
    const lost = (await members[2].call('GET', `/groups/${groupId}/members/${id}/profile`)).body;
    assert.equal(lost.achievements.find((a: any) => a.code === 'pages_100').earnedAt, null);

    const memberUser = (await members[1].call('GET', '/me')).body.user.id as string;
    await assert.rejects(
      h.database.withUser(memberUser, (db) => db.query('select app.set_pages_before($1::uuid, $2::uuid, 5)', [groupId, id])),
      /not allowed/,
    );
    const direct = await h.database.withUser(memberUser, async (db) => (await db.query('update public.group_members set pages_before = 5 where id = $1', [id])).rowCount);
    assert.equal(direct, 0, 'напрямую строку участника менять нельзя');
  });

  test('новая группа независима, блокировка и удаление участника меняют цель', async () => {
    const newcomer = await outsider.call('POST', '/groups', { name: 'Вторая', timezone: 'Asia/Tashkent', dailyMinimum: 5, displayName: 'Гость' });
    assert.equal(newcomer.status, 201);
    const d2 = (await outsider.call('GET', `/groups/${newcomer.body.groupId}/dashboard`)).body;
    assert.equal(d2.progress.goalPages, 604);
    assert.equal(d2.today.dailyMinimum, 5);
    assert.equal((await members[0].call('GET', `/groups/${newcomer.body.groupId}/dashboard`)).status, 403);

    const id = memberIds['Мухаммад'];
    assert.equal((await members[1].call('PATCH', `/groups/${groupId}/members/${id}`, { status: 'blocked' })).status, 403);
    assert.equal((await members[0].call('PATCH', `/groups/${groupId}/members/${id}`, { status: 'blocked' })).status, 204);
    assert.equal((await members[3].call('GET', `/groups/${groupId}/dashboard`)).status, 403);
    assert.equal((await members[3].call('POST', `/invites/${invite}/join`, { displayName: 'x' })).status, 403);
    assert.equal((await members[0].call('GET', `/groups/${groupId}/dashboard`)).body.progress.goalPages, 2416);

    assert.equal((await members[0].call('PATCH', `/groups/${groupId}/members/${memberIds['Мурад']}`, { status: 'blocked' })).status, 403, 'владельца заблокировать нельзя');
    assert.equal((await members[0].call('PATCH', `/groups/${groupId}/members/${id}`, { status: 'active' })).status, 204);
    assert.equal((await members[3].call('GET', `/groups/${groupId}/dashboard`)).status, 200);
  });
});
