import type { MemberStats } from './stats.js';

/**
 * Библиотека собственных коротких фраз поддержки. Здесь намеренно нет аятов и
 * хадисов: религиозную цитату можно добавить только с проверенным источником.
 */
export type MotivationCategory = 'start' | 'steady' | 'streak' | 'debt' | 'done_today' | 'near_finish' | 'finished';

export const MOTIVATION: Record<MotivationCategory, string[]> = {
  start: [
    'Первая страница важнее всех планов.',
    'Начать можно сегодня, с двух страниц.',
    'Путь складывается из коротких ежедневных шагов.',
  ],
  steady: [
    'Постоянство важнее скорости.',
    'Немного, но каждый день. Так и завершают Хатм.',
    'Две страницы сегодня приближают всю группу.',
    'Вы читаете не в одиночку: рядом идут ещё люди.',
    'Выберите спокойное время, и страницы найдут своё место в дне.',
  ],
  streak: [
    '{streak} дн. подряд. Сохраняйте этот ритм.',
    'Серия {streak} дн. держится на обычных днях, как сегодняшний.',
    'Уже {streak} дн. без пропуска нормы. Хорошее постоянство.',
  ],
  debt: [
    'Осталось наверстать {debt} стр. По паре лишних страниц — и долга не будет.',
    'Каждая страница уменьшает долг. Начните с малого.',
    'Вернуться можно в любой день. Группа ждёт вас.',
  ],
  done_today: [
    'Норма на сегодня выполнена.',
    'Сегодняшняя страница вписана. До завтра.',
    'День отмечен. Спасибо, что идёте вместе со всеми.',
  ],
  near_finish: [
    'До завершения Хатма {remaining} стр.',
    'Осталось {remaining} стр. Финиш уже виден.',
  ],
  finished: [
    'Хатм завершён. Вы прошли этот путь до конца.',
    'Все 604 страницы позади. Новый круг можно начать, когда будете готовы.',
  ],
};

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

export function motivationCategory(stats: MemberStats): MotivationCategory {
  if (stats.totalPages === 0) return 'start';
  if (stats.remaining === 0) return 'finished';
  if (stats.remaining <= 30) return 'near_finish';
  if (stats.debt > 0) return 'debt';
  if (stats.todayMet) return 'done_today';
  if (stats.currentStreak >= 3) return 'streak';
  return 'steady';
}

/** Фраза стабильна в течение дня и меняется от дня ко дню. */
export function pickMotivation(stats: MemberStats, seed: string): string {
  const variants = MOTIVATION[motivationCategory(stats)];
  return variants[hash(seed) % variants.length]
    .replace('{streak}', String(stats.currentStreak))
    .replace('{debt}', String(stats.debt))
    .replace('{remaining}', String(stats.remaining));
}
