import { QURAN_PAGES } from './constants.js';
import type { MemberStats } from './stats.js';

export type AchievementCode =
  | 'first_report'
  | 'streak_7'
  | 'streak_14'
  | 'streak_30'
  | 'streak_100'
  | 'first_khatm'
  | 'pages_100'
  | 'pages_300'
  | 'pages_500';

export interface AchievementDef {
  code: AchievementCode;
  title: string;
  description: string;
  kind: 'report' | 'streak' | 'pages' | 'khatm';
  target: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { code: 'first_report', title: 'Первый отчёт', description: 'С него начинается путь', kind: 'report', target: 1 },
  { code: 'streak_7', title: '7 дней постоянства', description: 'Неделя с выполненной нормой подряд', kind: 'streak', target: 7 },
  { code: 'streak_14', title: '14 дней постоянства', description: 'Две недели без пропуска нормы', kind: 'streak', target: 14 },
  { code: 'streak_30', title: '30 дней постоянства', description: 'Месяц, и чтение стало привычкой', kind: 'streak', target: 30 },
  { code: 'streak_100', title: '100 дней постоянства', description: 'Сто дней подряд с выполненной нормой', kind: 'streak', target: 100 },
  { code: 'pages_100', title: '100 страниц', description: 'Первая сотня прочитана', kind: 'pages', target: 100 },
  { code: 'pages_300', title: '300 страниц', description: 'Почти половина мусхафа', kind: 'pages', target: 300 },
  { code: 'pages_500', title: '500 страниц', description: 'До конца уже совсем близко', kind: 'pages', target: 500 },
  { code: 'first_khatm', title: 'Первый завершённый Хатм', description: 'Прочитаны все 604 страницы', kind: 'khatm', target: QURAN_PAGES },
];

export interface AchievementInput {
  reportCount: number;
  stats: Pick<MemberStats, 'totalPages' | 'bestStreak'>;
}

export function achievementProgress(def: AchievementDef, input: AchievementInput): number {
  switch (def.kind) {
    case 'report':
      return Math.min(input.reportCount, def.target);
    case 'streak':
      return Math.min(input.stats.bestStreak, def.target);
    case 'pages':
    case 'khatm':
      return Math.min(input.stats.totalPages, def.target);
  }
}

export function earnedAchievements(input: AchievementInput): AchievementCode[] {
  return ACHIEVEMENTS.filter((def) => achievementProgress(def, input) >= def.target).map((d) => d.code);
}

export function achievementByCode(code: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.code === code);
}
