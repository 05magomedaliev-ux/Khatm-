/** Все календарные даты в системе — строки YYYY-MM-DD без времени и часового пояса. */
const DAY_MS = 86_400_000;

function toUtc(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = toUtc(value);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Сколько дней от `from` до `to` (to − from). */
export function diffDays(to: string, from: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

function zoneParts(timeZone: string, now: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** Текущая календарная дата в часовом поясе группы. */
export function localDate(timeZone: string, now: Date = new Date()): string {
  const p = zoneParts(timeZone, now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Минуты от начала суток в часовом поясе группы. */
export function localMinutes(timeZone: string, now: Date = new Date()): number {
  const p = zoneParts(timeZone, now);
  return Number(p.hour) * 60 + Number(p.minute);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** "20:30" или "20:30:00" → минуты от начала суток. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Все даты месяца "YYYY-MM". */
export function monthDays(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** Сдвиг месяца "YYYY-MM" на n месяцев. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Понедельник = 0 … воскресенье = 6. */
export function weekdayIndex(date: string): number {
  return (new Date(toUtc(date)).getUTCDay() + 6) % 7;
}
