const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export const days = (n: number) => `${n} ${plural(n, ['день', 'дня', 'дней'])}`;
export const pages = (n: number) => `${n} стр.`;
export const people = (n: number) => `${n} ${plural(n, ['участник', 'участника', 'участников'])}`;

export function formatDate(date: string, withYear = false): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}${withYear ? ` ${y}` : ''}`;
}

export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}, ${time}`;
}

export function relativeDay(date: string, today: string, yesterday: string): string {
  if (date === today) return 'сегодня';
  if (date === yesterday) return 'вчера';
  return formatDate(date);
}

export function reportScope(r: { kind: 'count' | 'range'; startPage: number | null; endPage: number | null }): string {
  return r.kind === 'range' ? `Страницы ${r.startPage}–${r.endPage}` : 'Указано количество';
}

export function number(n: number): string {
  return n.toLocaleString('ru-RU');
}

export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}
