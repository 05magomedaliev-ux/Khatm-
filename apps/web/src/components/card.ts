import type { ProfileResponse } from '@khatm/shared';
import { JUZ_COUNT, QURAN_PAGES } from '@khatm/shared';
import { formatDate, number } from '../lib/format';

const W = 1080;
const H = 1350;
const C = {
  cover: '#103229',
  deep: '#0b251e',
  gold: '#c6a15a',
  goldSoft: '#e3cc95',
  cream: '#f7f0e1',
  muted: '#a9bcb0',
};
const SERIF = 'Lora, Georgia, serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  for (const angle of [0, Math.PI / 4]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }
}

function rosette(ctx: CanvasRenderingContext2D, cx: number, cy: number, fraction: number) {
  const filled = fraction * JUZ_COUNT;
  const [inner, mid, outer, half] = [210, 272, 320, 25.5];
  for (let i = 0; i < JUZ_COUNT; i += 1) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((i * 2 * Math.PI) / JUZ_COUNT);
    const petal = new Path2D(`M0,${-inner} L${half},${-mid} L0,${-outer} L${-half},${-mid} Z`);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(198,161,90,.45)';
    ctx.fillStyle = 'rgba(247,240,225,.05)';
    ctx.fill(petal);
    ctx.stroke(petal);
    const level = Math.max(0, Math.min(1, filled - i));
    if (level > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(-40, -inner - (outer - inner) * level, 80, (outer - inner) * level);
      ctx.clip();
      ctx.fillStyle = C.gold;
      ctx.fill(petal);
      ctx.restore();
    }
    ctx.restore();
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(' ');
  let line = '';
  let cursor = y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, cursor);
      line = word;
      cursor += lineHeight;
    } else {
      line = next;
    }
  }
  ctx.fillText(line, x, cursor);
}

function metric(ctx: CanvasRenderingContext2D, x: number, y: number, value: string, label: string) {
  ctx.textAlign = 'center';
  ctx.fillStyle = C.cream;
  ctx.font = `600 62px ${SERIF}`;
  ctx.fillText(value, x, y);
  ctx.fillStyle = C.muted;
  ctx.font = `400 30px ${SANS}`;
  ctx.fillText(label, x, y + 46);
}

/** Рисует персональную карточку из реальных показателей участника. */
export async function renderCard(profile: ProfileResponse, groupName: string): Promise<HTMLCanvasElement> {
  await document.fonts?.load(`600 62px Lora`).catch(() => undefined);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas недоступен');
  const { stats, member } = profile;

  ctx.fillStyle = C.cover;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(198,161,90,.07)';
  ctx.lineWidth = 2;
  for (let y = 0; y <= H + 135; y += 135) {
    for (let x = 0; x <= W + 135; x += 135) star(ctx, x, y, 48);
  }

  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, W - 72, H - 72);
  ctx.lineWidth = 1;
  ctx.strokeRect(48, 48, W - 96, H - 96);

  ctx.textAlign = 'center';
  ctx.fillStyle = C.goldSoft;
  ctx.font = `500 36px ${SERIF}`;
  ctx.fillText(groupName, W / 2, 128);
  ctx.fillStyle = C.cream;
  ctx.font = `600 76px ${SERIF}`;
  ctx.fillText(member.name, W / 2, 218);

  const cy = 590;
  rosette(ctx, W / 2, cy, stats.pagesInCurrent / QURAN_PAGES);
  ctx.textAlign = 'center';
  ctx.fillStyle = C.cream;
  ctx.font = `600 104px ${SERIF}`;
  ctx.fillText(`${stats.percent}%`, W / 2, cy + 18);
  ctx.fillStyle = C.muted;
  ctx.font = `400 32px ${SANS}`;
  ctx.fillText(`${stats.pagesInCurrent} из ${QURAN_PAGES} стр.`, W / 2, cy + 72);

  const row = 1000;
  metric(ctx, W * 0.2, row, number(stats.totalPages), 'страниц всего');
  metric(ctx, W * 0.5, row, String(stats.currentStreak), 'дней подряд');
  metric(ctx, W * 0.8, row, String(stats.averagePace), 'стр. в день');

  ctx.textAlign = 'center';
  ctx.fillStyle = C.goldSoft;
  ctx.font = `500 40px ${SERIF}`;
  wrap(ctx, profile.motivation, W / 2, 1160, W - 240, 54);

  if (stats.forecastDate) {
    ctx.fillStyle = C.muted;
    ctx.font = `400 28px ${SANS}`;
    ctx.fillText(`Прогноз завершения: ${formatDate(stats.forecastDate, true)}`, W / 2, 1272);
  }
  return canvas;
}
