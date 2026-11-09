import { QURAN_PAGES } from './constants.js';

export interface ReportForOverlap {
  id: string;
  kind: 'count' | 'range';
  pages: number;
  startPage: number | null;
  endPage: number | null;
  readOn: string;
  createdAt: string;
}

export interface RangeOverlap {
  reportId: string;
  startPage: number;
  endPage: number;
  readOn: string;
  overlapStart: number;
  overlapEnd: number;
}

/**
 * Отчёты текущего круга чтения: всё, что было после завершения последнего Хатма.
 * Повторное чтение в новом круге — норма и предупреждения не вызывает.
 */
export function currentCycleReports(reports: ReportForOverlap[]): ReportForOverlap[] {
  const ordered = [...reports].sort(
    (a, b) => a.readOn.localeCompare(b.readOn) || a.createdAt.localeCompare(b.createdAt),
  );
  const total = ordered.reduce((sum, r) => sum + r.pages, 0);
  const threshold = Math.floor(total / QURAN_PAGES) * QURAN_PAGES;
  if (threshold === 0) return ordered;
  let cumulative = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    cumulative += ordered[i].pages;
    if (cumulative >= threshold) return ordered.slice(i + 1);
  }
  return [];
}

/**
 * Проверяются только точные отчёты-диапазоны. Отчёты-количества не содержат
 * номеров страниц, поэтому пересечение с ними определить невозможно.
 */
export function findRangeOverlaps(
  start: number,
  end: number,
  reports: ReportForOverlap[],
): RangeOverlap[] {
  const overlaps: RangeOverlap[] = [];
  for (const r of currentCycleReports(reports)) {
    if (r.kind !== 'range' || r.startPage === null || r.endPage === null) continue;
    const overlapStart = Math.max(start, r.startPage);
    const overlapEnd = Math.min(end, r.endPage);
    if (overlapStart <= overlapEnd) {
      overlaps.push({
        reportId: r.id,
        startPage: r.startPage,
        endPage: r.endPage,
        readOn: r.readOn,
        overlapStart,
        overlapEnd,
      });
    }
  }
  return overlaps;
}

export function rangePages(start: number, end: number): number {
  return end - start + 1;
}
