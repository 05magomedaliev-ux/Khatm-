import {
  DEBT_RATING_CAP_NORMS,
  FORECAST_MIN_DAYS,
  FORECAST_WINDOW_DAYS,
  QURAN_PAGES,
  STREAK_RATING_CAP_DAYS,
} from './constants.js';
import { addDays } from './dates.js';
import type { LedgerDay } from './ledger.js';

export interface KhatmProgress {
  khatmsCompleted: number;
  pagesInCurrent: number;
  percent: number;
  remaining: number;
}

/** Ровно 604 страницы показываются как завершённый круг (100%), а не как новый с нуля. */
export function khatmProgress(totalPages: number): KhatmProgress {
  const khatmsCompleted = Math.floor(totalPages / QURAN_PAGES);
  const justFinished = totalPages > 0 && totalPages % QURAN_PAGES === 0;
  const pagesInCurrent = justFinished ? QURAN_PAGES : totalPages % QURAN_PAGES;
  return {
    khatmsCompleted,
    pagesInCurrent,
    percent: round1((pagesInCurrent / QURAN_PAGES) * 100),
    remaining: QURAN_PAGES - pagesInCurrent,
  };
}

export interface BestDay {
  date: string;
  pages: number;
}

export interface MemberStats extends KhatmProgress {
  totalPages: number;
  averagePace: number;
  today: number;
  yesterday: number;
  last7: number;
  last30: number;
  /** Текущий долг без учёта нормы незавершённого дня. */
  debt: number;
  /** Сколько страниц осталось сегодня, чтобы закрыть долг и норму дня. */
  remainingToday: number;
  todayNorm: number;
  todayMet: boolean;
  completedDays: number;
  trackedDays: number;
  currentStreak: number;
  bestStreak: number;
  bestDay: BestDay | null;
  forecastDate: string | null;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function sumLast(ledger: LedgerDay[], count: number): number {
  return ledger.slice(-count).reduce((sum, d) => sum + d.pages, 0);
}

export function computeStats(ledger: LedgerDay[], today: string): MemberStats {
  const totalPages = ledger.reduce((sum, d) => sum + d.pages, 0);
  const progress = khatmProgress(totalPages);
  const todayEntry = ledger.find((d) => d.date === today);
  const yesterdayEntry = ledger.find((d) => d.date === addDays(today, -1));
  const closed = ledger.filter((d) => !d.provisional);

  // Незавершённый день без страниц не занижает темп: отсутствие отчёта ещё ничего не значит.
  const elapsed = closed.length + (todayEntry && todayEntry.pages > 0 ? 1 : 0);
  const averagePace = elapsed > 0 ? round1(totalPages / elapsed) : 0;

  let bestStreak = 0;
  let run = 0;
  let bestDay: BestDay | null = null;
  let completedDays = 0;
  for (const day of ledger) {
    if (day.normMet) {
      run += 1;
      completedDays += 1;
      bestStreak = Math.max(bestStreak, run);
    } else if (!day.provisional) {
      run = 0;
    }
    if (day.pages > 0 && (!bestDay || day.pages > bestDay.pages)) {
      bestDay = { date: day.date, pages: day.pages };
    }
  }

  return {
    ...progress,
    totalPages,
    averagePace,
    today: todayEntry?.pages ?? 0,
    yesterday: yesterdayEntry?.pages ?? 0,
    last7: sumLast(ledger, 7),
    last30: sumLast(ledger, 30),
    debt: todayEntry?.debtAfter ?? 0,
    remainingToday: todayEntry?.projectedDebt ?? 0,
    todayNorm: todayEntry?.norm ?? 0,
    todayMet: todayEntry?.normMet ?? false,
    completedDays,
    trackedDays: ledger.length,
    currentStreak: currentStreak(ledger),
    bestStreak,
    bestDay,
    forecastDate: forecast(ledger, today, progress.remaining, elapsed),
  };
}

/** Серия: незавершённый сегодняшний день её не обрывает, а выполненный — продлевает. */
export function currentStreak(ledger: LedgerDay[]): number {
  let streak = 0;
  for (let i = ledger.length - 1; i >= 0; i -= 1) {
    const day = ledger[i];
    if (day.normMet) streak += 1;
    else if (day.provisional) continue;
    else break;
  }
  return streak;
}

function forecast(ledger: LedgerDay[], today: string, remaining: number, elapsed: number): string | null {
  if (elapsed < FORECAST_MIN_DAYS || remaining <= 0) return null;
  const windowDays = Math.min(FORECAST_WINDOW_DAYS, elapsed);
  const relevant = ledger.filter((d) => !d.provisional || d.pages > 0).slice(-windowDays);
  const pages = relevant.reduce((sum, d) => sum + d.pages, 0);
  if (pages <= 0) return null;
  const pace = pages / windowDays;
  return addDays(today, Math.ceil(remaining / pace));
}

export interface DisciplineScore {
  /** null — ещё нет ни одного завершённого дня, рейтинг не присваивается. */
  score: number | null;
  completion: number | null;
  streakScore: number | null;
  debtScore: number | null;
  closedDays: number;
  closedStreak: number;
  closedDebt: number;
}

/** R = 0.7C + 0.2S + 0.1B. Незавершённый день не участвует. */
export function computeDiscipline(ledger: LedgerDay[]): DisciplineScore {
  const closed = ledger.filter((d) => !d.provisional);
  if (closed.length === 0) {
    return { score: null, completion: null, streakScore: null, debtScore: null, closedDays: 0, closedStreak: 0, closedDebt: 0 };
  }
  const met = closed.filter((d) => d.normMet).length;
  const completion = (met / closed.length) * 100;

  let closedStreak = 0;
  for (let i = closed.length - 1; i >= 0 && closed[i].normMet; i -= 1) closedStreak += 1;
  const streakScore = (Math.min(closedStreak, STREAK_RATING_CAP_DAYS) / STREAK_RATING_CAP_DAYS) * 100;

  const last = closed[closed.length - 1];
  const debtScore = Math.max(0, 100 * (1 - last.debtAfter / (DEBT_RATING_CAP_NORMS * last.norm)));

  return {
    score: round1(0.7 * completion + 0.2 * streakScore + 0.1 * debtScore),
    completion: round1(completion),
    streakScore: round1(streakScore),
    debtScore: round1(debtScore),
    closedDays: closed.length,
    closedStreak,
    closedDebt: last.debtAfter,
  };
}

/** Прогресс группы: вклад каждого ограничен одним Хатмом, чтобы 100% означало «завершили все». */
export function groupProgress(memberTotals: number[]) {
  const goalPages = memberTotals.length * QURAN_PAGES;
  const totalPages = memberTotals.reduce((a, b) => a + b, 0);
  const countedPages = memberTotals.reduce((a, b) => a + Math.min(b, QURAN_PAGES), 0);
  return {
    memberCount: memberTotals.length,
    goalPages,
    totalPages,
    countedPages,
    percent: goalPages > 0 ? round1((countedPages / goalPages) * 100) : 0,
  };
}

/** Места с учётом равенства: 1, 2, 2, 4. Записи уже отсортированы по убыванию значения. */
export function assignRanks<T>(items: T[], value: (item: T) => number): (T & { rank: number })[] {
  let rank = 0;
  let previous: number | undefined;
  return items.map((item, index) => {
    const v = value(item);
    if (v !== previous) {
      rank = index + 1;
      previous = v;
    }
    return { ...item, rank };
  });
}
