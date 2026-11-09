import { addDays } from './dates.js';

/**
 * Статус дня:
 *  met     — норма выполнена;
 *  partial — читали, но норма не выполнена (страницы могли уйти на закрытие долга);
 *  missed  — день завершился без единой страницы;
 *  none    — день ещё не наступил, идёт без отчёта или данных нет.
 */
export type DayStatus = 'met' | 'partial' | 'missed' | 'none';

export interface NormPeriod {
  effectiveFrom: string;
  dailyMinimum: number;
}

export interface LedgerDay {
  date: string;
  pages: number;
  norm: number;
  debtBefore: number;
  /** Сколько страниц дня ушло на закрытие накопленного долга. */
  paidDebt: number;
  /** Сколько страниц дня зачтено в норму этого дня. */
  appliedToNorm: number;
  /** Излишек: не переносится на будущие дни. */
  surplus: number;
  /** Долг на конец дня. Для незавершённого дня норма сегодняшнего дня в долг не входит. */
  debtAfter: number;
  /** Каким был бы долг, если день завершится прямо сейчас. */
  projectedDebt: number;
  normMet: boolean;
  /** День ещё идёт: итог предварительный. */
  provisional: boolean;
  status: DayStatus;
}

export function normForDate(norms: NormPeriod[], date: string): number {
  if (norms.length === 0) throw new Error('У группы не задана норма');
  const sorted = [...norms].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let norm = sorted[0].dailyMinimum;
  for (const period of sorted) {
    if (period.effectiveFrom <= date) norm = period.dailyMinimum;
  }
  return norm;
}

/** Один шаг формулы DebtToday = max(0, DebtYesterday + DailyMinimum − PagesReadToday). */
export function allocateDay(debtBefore: number, norm: number, pages: number) {
  const paidDebt = Math.min(debtBefore, pages);
  const appliedToNorm = Math.min(norm, pages - paidDebt);
  const surplus = pages - paidDebt - appliedToNorm;
  const closedDebt = Math.max(0, debtBefore + norm - pages);
  return { paidDebt, appliedToNorm, surplus, closedDebt, normMet: appliedToNorm >= norm };
}

export interface LedgerInput {
  startDate: string;
  today: string;
  pagesByDate: Record<string, number>;
  norms: NormPeriod[];
}

/**
 * Единственный источник истины по задолженности. Считается целиком из отчётов,
 * поэтому правка или удаление задним числом автоматически пересчитывает все
 * последующие дни.
 */
export function buildLedger({ startDate, today, pagesByDate, norms }: LedgerInput): LedgerDay[] {
  const earliestReport = Object.keys(pagesByDate).sort()[0];
  const start = earliestReport && earliestReport < startDate ? earliestReport : startDate;
  const days: LedgerDay[] = [];
  let debt = 0;

  for (let date = start; date <= today; date = addDays(date, 1)) {
    const pages = pagesByDate[date] ?? 0;
    const norm = normForDate(norms, date);
    const provisional = date === today;
    const { paidDebt, appliedToNorm, surplus, closedDebt, normMet } = allocateDay(debt, norm, pages);
    const debtAfter = provisional ? debt - paidDebt : closedDebt;

    let status: DayStatus;
    if (normMet) status = 'met';
    else if (pages > 0) status = 'partial';
    else status = provisional ? 'none' : 'missed';

    days.push({
      date,
      pages,
      norm,
      debtBefore: debt,
      paidDebt,
      appliedToNorm,
      surplus,
      debtAfter,
      projectedDebt: closedDebt,
      normMet,
      provisional,
      status,
    });
    debt = debtAfter;
  }
  return days;
}
