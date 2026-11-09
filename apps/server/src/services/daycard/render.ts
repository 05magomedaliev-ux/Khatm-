import { JUZ_COUNT, MOTIVATION } from '@khatm/shared';
import sharp from 'sharp';
import { progressOf, summarizeToday, type ComputedMember, type GroupData } from '../analytics.js';
import { GLYPHS } from './glyphs.js';

const W = 1080;
const COVER_HEIGHT = 560;
const SHEET_TOP = 520;
const ROW_HEIGHT = 112;
const ROWS_START = 628;
/** Telegram уменьшает длинные снимки, поэтому в карточку входит ограниченное число строк. */
const MAX_ROWS = 15;

const C = {
  cover: '#103229',
  gold: '#c6a15a',
  goldSoft: '#e3cc95',
  goldInk: '#8f6b23',
  page: '#f7f0e1',
  ink: '#17302a',
  ink2: '#51635a',
  rule: '#dfd2b6',
  muted: '#a9bcb0',
  ok: '#2c8a5d',
  partial: '#e0ae22',
  none: '#dcd5c5',
};

type Weight = 'regular' | 'semibold';
type Anchor = 'start' | 'middle' | 'end';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function formatDay(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

function group3(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function percent(value: number): string {
  return `${String(value).replace('.', ',')}%`;
}

/** Символы вне набора шрифта (эмодзи, другие алфавиты) пропускаются. */
function supported(text: string, weight: Weight): string {
  return [...text].filter((ch) => GLYPHS[weight][ch]).join('').trim();
}

function width(text: string, size: number, weight: Weight): number {
  const scale = size / GLYPHS.upem;
  return [...text].reduce((sum, ch) => sum + (GLYPHS[weight][ch]?.[0] ?? 0) * scale, 0);
}

function fit(raw: string, size: number, weight: Weight, maxWidth: number): string {
  const text = supported(raw, weight);
  if (width(text, size, weight) <= maxWidth) return text;
  let cut = [...text];
  while (cut.length > 1 && width(`${cut.join('').trimEnd()}…`, size, weight) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.join('').trimEnd()}…`;
}

/** Перенос по словам, не больше двух строк. */
function wrap(raw: string, size: number, weight: Weight, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of supported(raw, weight).split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next, size, weight) > maxWidth && lines.length === 0) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  lines.push(fit(line, size, weight, maxWidth));
  return lines;
}

function text(value: string, x: number, y: number, size: number, fill: string, weight: Weight = 'regular', anchor: Anchor = 'start'): string {
  const content = supported(value, weight);
  const total = width(content, size, weight);
  const startX = anchor === 'end' ? x - total : anchor === 'middle' ? x - total / 2 : x;
  const scale = size / GLYPHS.upem;
  let cursor = 0;
  const paths: string[] = [];
  for (const ch of content) {
    const [advance, d] = GLYPHS[weight][ch];
    if (d) paths.push(`<path transform="translate(${cursor} 0)" d="${d}"/>`);
    cursor += advance;
  }
  return `<g fill="${fill}" transform="translate(${startX.toFixed(1)} ${y}) scale(${scale.toFixed(5)} ${(-scale).toFixed(5)})">${paths.join('')}</g>`;
}

function octagon(x: number, y: number, size: number, cut: number): string {
  const e = x + size;
  const b = y + size;
  return `${x + cut},${y} ${e - cut},${y} ${e},${y + cut} ${e},${b - cut} ${e - cut},${b} ${x + cut},${b} ${x},${b - cut} ${x},${y + cut}`;
}

function rosette(cx: number, cy: number, fraction: number): string {
  const [inner, mid, outer, half] = [132, 168, 198, 15.4];
  const petal = `M0,${-inner} L${half},${-mid} L0,${-outer} L${-half},${-mid} Z`;
  const filled = Math.min(1, fraction) * JUZ_COUNT;
  let out = `<g transform="translate(${cx} ${cy})"><circle r="${inner - 8}" fill="none" stroke="${C.gold}" stroke-opacity=".55" stroke-width="1.2"/>`;
  for (let i = 0; i < JUZ_COUNT; i += 1) {
    const level = Math.max(0, Math.min(1, filled - i));
    out += `<g transform="rotate(${i * (360 / JUZ_COUNT)})"><path d="${petal}" fill="${C.page}" fill-opacity=".05" stroke="${C.gold}" stroke-opacity=".45" stroke-width="1.2"/>`;
    if (level > 0) {
      const top = -inner - (outer - inner) * level;
      out += `<clipPath id="p${i}"><rect x="-20" y="${top}" width="40" height="${inner * -1 - top + 1}"/></clipPath><path d="${petal}" fill="${C.gold}" clip-path="url(#p${i})"/>`;
    }
    out += '</g>';
  }
  return `${out}</g>`;
}

const STATUS_TEXT: Record<string, string> = {
  met: 'норма выполнена',
  partial: 'читает, норма впереди',
  none: 'отчёта пока нет',
  missed: 'отчёта пока нет',
  not_joined: 'ещё не подключился',
};

function statusOf(m: ComputedMember): string {
  if (m.stats.todayMet) return 'met';
  if (m.stats.today > 0) return 'partial';
  return m.member.user_id === null ? 'not_joined' : 'none';
}

function sealColors(status: string): { fill: string; ink: string } {
  if (status === 'met') return { fill: C.ok, ink: '#ffffff' };
  if (status === 'partial') return { fill: C.partial, ink: C.ink };
  return { fill: C.none, ink: C.ink2 };
}

function row(m: ComputedMember, y: number, isLast: boolean): string {
  const status = statusOf(m);
  const seal = sealColors(status);
  const initial = [...supported(m.member.display_name, 'semibold')][0] ?? '?';
  let out = `<polygon points="${octagon(64, y + 24, 64, 19)}" fill="${seal.fill}"/>`;
  out += text(initial, 96, y + 68, 32, seal.ink, 'semibold', 'middle');
  out += text(fit(m.member.display_name, 36, 'semibold', 410), 152, y + 54, 36, C.ink, 'semibold');
  out += text(STATUS_TEXT[status], 152, y + 90, 25, C.ink2);
  out += text(m.stats.today > 0 ? String(m.stats.today) : '—', 716, y + 66, 46, m.stats.today > 0 ? C.ink : C.ink2, 'semibold', 'end');
  out += text(m.stats.currentStreak > 0 ? String(m.stats.currentStreak) : '—', 858, y + 64, 34, C.ink, 'regular', 'end');
  out += text(percent(m.stats.percent), 1016, y + 64, 34, C.ink, 'regular', 'end');
  if (!isLast) out += `<line x1="64" x2="1016" y1="${y + ROW_HEIGHT}" y2="${y + ROW_HEIGHT}" stroke="${C.rule}" stroke-width="1.5"/>`;
  return out;
}

export function dayCardSvg(data: GroupData): string {
  const day = summarizeToday(data);
  const progress = progressOf(data);
  const ordered = [...data.members].sort(
    (a, b) => b.stats.today - a.stats.today || b.stats.currentStreak - a.stats.currentStreak || a.member.display_name.localeCompare(b.member.display_name, 'ru'),
  );
  const visible = ordered.slice(0, MAX_ROWS);
  const hidden = ordered.length - visible.length;

  const rowsEnd = ROWS_START + visible.length * ROW_HEIGHT;
  const motivationLines = wrap(MOTIVATION.steady[Number(data.today.slice(8)) % MOTIVATION.steady.length], 33, 'regular', 952);
  const footerY = rowsEnd + (hidden > 0 ? 112 : 66);
  const height = footerY + 104 + (motivationLines.length - 1) * 42;
  const goalShare = day.groupGoal > 0 ? Math.min(1, day.pages / day.groupGoal) : 0;

  const bigNumber = group3(day.pages);
  const bigWidth = width(bigNumber, 148, 'semibold');

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">`;
  svg += `<defs><pattern id="tile" width="96" height="96" patternUnits="userSpaceOnUse"><polygon points="96,48 82,62 82,82 62,82 48,96 34,82 14,82 14,62 0,48 14,34 14,14 34,14 48,0 62,14 82,14 82,34" fill="none" stroke="${C.gold}" stroke-opacity=".13" stroke-width="1.5"/></pattern></defs>`;
  svg += `<rect width="${W}" height="${COVER_HEIGHT}" fill="${C.cover}"/><rect width="${W}" height="${COVER_HEIGHT}" fill="url(#tile)"/>`;

  svg += text('Итоги дня', 64, 112, 58, C.page, 'semibold');
  svg += text(fit(`${data.group.name}, ${formatDay(data.today)}`, 31, 'regular', 560), 64, 162, 31, C.goldSoft);
  svg += text(bigNumber, 64, 312, 148, C.page, 'semibold');
  svg += text('стр.', 64 + bigWidth + 18, 312, 48, C.goldSoft);
  svg += text(`прочитано при цели ${day.groupGoal}`, 64, 362, 31, C.muted);
  svg += `<rect x="64" y="386" width="540" height="10" rx="5" fill="${C.page}" fill-opacity=".14"/>`;
  if (goalShare > 0) svg += `<rect x="64" y="386" width="${Math.max(10, 540 * goalShare)}" height="10" rx="5" fill="${C.gold}"/>`;
  svg += text(`Норму выполнили ${day.metCount} из ${day.startedCount}`, 64, 456, 36, C.page);

  const cx = 830;
  const cy = 268;
  svg += rosette(cx, cy, progress.goalPages > 0 ? progress.countedPages / progress.goalPages : 0);
  svg += text(percent(progress.percent), cx, cy + 8, 62, C.page, 'semibold', 'middle');
  svg += text(`${group3(progress.totalPages)} из ${group3(progress.goalPages)}`, cx, cy + 46, 25, C.goldSoft, 'regular', 'middle');
  svg += text('страниц', cx, cy + 76, 22, C.muted, 'regular', 'middle');

  svg += `<path d="M0,${SHEET_TOP + 40} Q0,${SHEET_TOP} 40,${SHEET_TOP} L${W - 40},${SHEET_TOP} Q${W},${SHEET_TOP} ${W},${SHEET_TOP + 40} L${W},${height} L0,${height} Z" fill="${C.page}"/>`;
  svg += `<path d="M0,${SHEET_TOP + 40} Q0,${SHEET_TOP} 40,${SHEET_TOP} L${W - 40},${SHEET_TOP} Q${W},${SHEET_TOP} ${W},${SHEET_TOP + 40}" fill="none" stroke="${C.gold}" stroke-width="2"/>`;

  svg += text('Участник', 64, 604, 26, C.ink2);
  svg += text('Сегодня', 716, 604, 26, C.ink2, 'regular', 'end');
  svg += text('Серия', 858, 604, 26, C.ink2, 'regular', 'end');
  svg += text('Хатм', 1016, 604, 26, C.ink2, 'regular', 'end');
  svg += `<line x1="64" x2="1016" y1="${ROWS_START}" y2="${ROWS_START}" stroke="${C.rule}" stroke-width="1.5"/>`;

  visible.forEach((m, index) => {
    svg += row(m, ROWS_START + index * ROW_HEIGHT, index === visible.length - 1);
  });

  if (hidden > 0) svg += text(`И ещё участников: ${hidden}`, 64, rowsEnd + 50, 28, C.ink2);
  motivationLines.forEach((line, index) => {
    svg += text(line, 64, footerY + index * 42, 33, C.goldInk);
  });
  svg += text('Итог предварительный, пока день не завершился', 64, footerY + (motivationLines.length - 1) * 42 + 44, 25, C.ink2);
  return `${svg}</svg>`;
}

sharp.cache(false);
sharp.concurrency(1);

export async function renderDayCard(data: GroupData): Promise<Buffer> {
  return sharp(Buffer.from(dayCardSvg(data))).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
}
