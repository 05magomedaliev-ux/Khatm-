import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  achievementProgress, ACHIEVEMENTS, addDays, assignRanks, buildLedger, computeDiscipline, computeStats,
  currentCycleReports, earnedAchievements, findRangeOverlaps, groupProgress, khatmProgress, localDate,
  type ReportForOverlap,
} from '../src/index.js';

const norms = [{ effectiveFrom: '2026-01-01', dailyMinimum: 2 }];
const ledger = (pagesByDate: Record<string, number>, today: string, startDate = '2026-03-02') =>
  buildLedger({ startDate, today, pagesByDate, norms });

test('пример из ТЗ: пн 2, вт 0, ср 4 → долг 0', () => {
  const days = ledger({ '2026-03-02': 2, '2026-03-04': 4 }, '2026-03-05');
  assert.equal(days[0].debtAfter, 0);
  assert.equal(days[0].status, 'met');
  assert.equal(days[1].debtAfter, 2);
  assert.equal(days[1].status, 'missed');
  assert.equal(days[2].paidDebt, 2);
  assert.equal(days[2].appliedToNorm, 2);
  assert.equal(days[2].debtAfter, 0);
  assert.equal(days[2].status, 'met');
});

test('формула совпадает с max(0, вчера + норма − сегодня) на всём диапазоне', () => {
  for (let debt = 0; debt < 12; debt += 2) {
    for (let pages = 0; pages < 20; pages += 1) {
      const pagesByDate: Record<string, number> = { '2026-03-10': pages };
      for (let i = 0; i < debt / 2; i += 1) pagesByDate[addDays('2026-03-02', i)] = 0;
      const start = addDays('2026-03-10', -debt / 2);
      const days = buildLedger({ startDate: start, today: '2026-03-11', pagesByDate: { '2026-03-10': pages }, norms });
      const target = days.find((d) => d.date === '2026-03-10')!;
      assert.equal(target.debtBefore, debt);
      assert.equal(target.debtAfter, Math.max(0, debt + 2 - pages));
      assert.equal(target.paidDebt + target.appliedToNorm + target.surplus, pages);
    }
  }
});

test('излишек не переносится на будущие дни', () => {
  const days = ledger({ '2026-03-02': 50 }, '2026-03-04');
  assert.equal(days[0].surplus, 48);
  assert.equal(days[1].debtAfter, 2);
  assert.equal(days[1].status, 'missed');
});

test('сначала закрывается долг: при долге норма дня не считается выполненной', () => {
  const days = ledger({ '2026-03-03': 2 }, '2026-03-04');
  assert.equal(days[0].debtAfter, 2);
  assert.equal(days[1].paidDebt, 2);
  assert.equal(days[1].appliedToNorm, 0);
  assert.equal(days[1].normMet, false);
  assert.equal(days[1].status, 'partial');
  assert.equal(days[1].debtAfter, 2);
});

test('сегодняшний день предварительный: без отчёта нет ни красного статуса, ни долга', () => {
  const days = ledger({}, '2026-03-02');
  assert.equal(days[0].provisional, true);
  assert.equal(days[0].status, 'none');
  assert.equal(days[0].debtAfter, 0);
  assert.equal(days[0].projectedDebt, 2);
});

test('правка задним числом пересчитывает всю цепочку', () => {
  const before = ledger({ '2026-03-05': 2 }, '2026-03-06');
  assert.equal(before.at(-2)!.debtAfter, 6);
  const after = ledger({ '2026-03-02': 2, '2026-03-03': 2, '2026-03-04': 2, '2026-03-05': 2 }, '2026-03-06');
  assert.equal(after.at(-2)!.debtAfter, 0);
});

test('смена нормы действует только с даты вступления', () => {
  const days = buildLedger({
    startDate: '2026-03-01', today: '2026-03-04', pagesByDate: {},
    norms: [{ effectiveFrom: '2026-01-01', dailyMinimum: 2 }, { effectiveFrom: '2026-03-03', dailyMinimum: 5 }],
  });
  assert.deepEqual(days.map((d) => d.norm), [2, 2, 5, 5]);
  assert.equal(days[2].debtAfter, 9);
});

test('серия: незавершённый день не обрывает, выполненный продлевает', () => {
  const pages = { '2026-03-02': 2, '2026-03-03': 2, '2026-03-04': 2 };
  assert.equal(computeStats(ledger(pages, '2026-03-05'), '2026-03-05').currentStreak, 3);
  assert.equal(computeStats(ledger({ ...pages, '2026-03-05': 2 }, '2026-03-05'), '2026-03-05').currentStreak, 4);
  assert.equal(computeStats(ledger(pages, '2026-03-06'), '2026-03-06').currentStreak, 0);
});

test('прогресс Хатма и граница ровно 604', () => {
  assert.deepEqual(khatmProgress(0), { khatmsCompleted: 0, pagesInCurrent: 0, percent: 0, remaining: 604 });
  assert.deepEqual(khatmProgress(604), { khatmsCompleted: 1, pagesInCurrent: 604, percent: 100, remaining: 0 });
  assert.equal(khatmProgress(610).pagesInCurrent, 6);
  assert.equal(khatmProgress(610).khatmsCompleted, 1);
});

test('прогресс группы динамический: участники × 604, вклад ограничен одним Хатмом', () => {
  const p = groupProgress([0, 0, 0, 0, 0]);
  assert.equal(p.goalPages, 3020);
  assert.equal(p.percent, 0);
  const q = groupProgress([1000, 0]);
  assert.equal(q.goalPages, 1208);
  assert.equal(q.totalPages, 1000);
  assert.equal(q.countedPages, 604);
  assert.equal(q.percent, 50);
});

test('прогноз не строится без данных', () => {
  assert.equal(computeStats(ledger({}, '2026-03-02'), '2026-03-02').forecastDate, null);
  assert.equal(computeStats(ledger({ '2026-03-02': 2 }, '2026-03-03'), '2026-03-03').forecastDate, null);
  const s = computeStats(ledger({ '2026-03-02': 4, '2026-03-03': 4, '2026-03-04': 4 }, '2026-03-05'), '2026-03-05');
  assert.equal(s.averagePace, 4);
  assert.equal(s.forecastDate, addDays('2026-03-05', Math.ceil(592 / 4)));
});

test('страницы до учёта идут в итог, но не в долг, темп и серии', () => {
  const l = ledger({ '2026-03-02': 4, '2026-03-03': 4, '2026-03-04': 4 }, '2026-03-05');
  const s = computeStats(l, '2026-03-05', 100);
  assert.equal(s.totalPages, 112);
  assert.equal(s.pagesBefore, 100);
  assert.equal(s.pagesInCurrent, 112);
  assert.equal(s.remaining, 492);
  assert.equal(s.averagePace, 4);
  assert.equal(s.debt, 0);
  assert.equal(s.currentStreak, 3);
  assert.equal(s.bestDay!.pages, 4);
  assert.equal(s.forecastDate, addDays('2026-03-05', Math.ceil(492 / 4)));
  assert.equal(computeStats([], '2026-03-05', 50).totalPages, 50);
});

test('рейтинг дисциплины: нет завершённых дней — нет рейтинга', () => {
  const d = computeDiscipline(ledger({ '2026-03-02': 10 }, '2026-03-02'));
  assert.equal(d.score, null);
  assert.equal(d.closedDays, 0);
});

test('рейтинг дисциплины: R = 0.7C + 0.2S + 0.1B, сегодняшний день не участвует', () => {
  const perfect = computeDiscipline(ledger({ '2026-03-02': 2, '2026-03-03': 2 }, '2026-03-04'));
  assert.equal(perfect.completion, 100);
  assert.equal(perfect.streakScore, 6.7);
  assert.equal(perfect.debtScore, 100);
  assert.equal(perfect.score, 81.3);

  const allMissed = computeDiscipline(ledger({}, '2026-03-04'));
  assert.equal(allMissed.completion, 0);
  assert.equal(allMissed.closedDebt, 4);
  assert.ok(allMissed.debtScore! < 100);
  for (const d of [perfect, allMissed]) {
    for (const v of [d.completion!, d.streakScore!, d.debtScore!]) assert.ok(v >= 0 && v <= 100);
  }
});

test('ранги с равенством', () => {
  const r = assignRanks([{ v: 9 }, { v: 5 }, { v: 5 }, { v: 1 }], (x) => x.v);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 2, 4]);
});

const rep = (id: string, kind: 'count' | 'range', pages: number, s: number | null, e: number | null, readOn = '2026-03-02'): ReportForOverlap =>
  ({ id, kind, pages, startPage: s, endPage: e, readOn, createdAt: `${readOn}T10:00:00Z` });

test('пересечения видны только между диапазонами', () => {
  const reports = [rep('a', 'range', 6, 20, 25), rep('b', 'count', 30, null, null)];
  assert.equal(findRangeOverlaps(26, 30, reports).length, 0);
  const o = findRangeOverlaps(25, 30, reports);
  assert.equal(o.length, 1);
  assert.equal(o[0].overlapStart, 25);
  assert.equal(o[0].overlapEnd, 25);
});

test('новый круг после завершённого Хатма не вызывает предупреждений', () => {
  const reports = [rep('a', 'range', 604, 1, 604, '2026-03-02'), rep('b', 'range', 5, 1, 5, '2026-03-03')];
  assert.equal(currentCycleReports(reports).length, 1);
  assert.equal(findRangeOverlaps(100, 110, reports).length, 0);
  assert.equal(findRangeOverlaps(3, 4, reports).length, 1);
});

test('страницы до учёта сдвигают границу круга чтения', () => {
  const reports = [rep('a', 'range', 10, 1, 10, '2026-03-02'), rep('b', 'range', 5, 1, 5, '2026-03-03')];
  assert.equal(currentCycleReports(reports, 594).length, 1, 'первый отчёт завершил Хатм');
  assert.equal(currentCycleReports(reports, 604).length, 2, 'Хатм завершён ещё до учёта');
  assert.equal(findRangeOverlaps(1, 3, reports, 0).length, 2);
});

test('достижения', () => {
  assert.deepEqual(earnedAchievements({ reportCount: 0, stats: { totalPages: 0, bestStreak: 0 } }), []);
  const codes = earnedAchievements({ reportCount: 12, stats: { totalPages: 320, bestStreak: 14 } });
  assert.deepEqual(codes.sort(), ['first_report', 'pages_100', 'pages_300', 'streak_14', 'streak_7'].sort());
  assert.ok(earnedAchievements({ reportCount: 2, stats: { totalPages: 604, bestStreak: 1 } }).includes('first_khatm'));
  assert.equal(achievementProgress(ACHIEVEMENTS.find((a) => a.code === 'pages_100')!, { reportCount: 1, stats: { totalPages: 42, bestStreak: 0 } }), 42);
});

test('граница суток считается в часовом поясе группы', () => {
  const now = new Date('2026-03-01T22:30:00Z');
  assert.equal(localDate('Europe/Moscow', now), '2026-03-02');
  assert.equal(localDate('UTC', now), '2026-03-01');
});
