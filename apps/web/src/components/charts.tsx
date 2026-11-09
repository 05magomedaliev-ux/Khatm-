import type { DayStatus } from '@khatm/shared';
import { useMemo, useState } from 'react';
import { formatDate } from '../lib/format';

interface Point {
  date: string;
  pages: number;
  norm: number;
  status: DayStatus;
}

const W = 340;
const H = 136;
const PAD_TOP = 8;
const PAD_BOTTOM = 18;

/** Страницы по дням: один ряд, линия нормы, нажатие на столбец показывает значение. */
export function PagesBars({ series }: { series: Point[] }) {
  const data = series.slice(-30);
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(4, ...data.map((d) => Math.max(d.pages, d.norm)));
  const plot = H - PAD_TOP - PAD_BOTTOM;
  const y = (v: number) => PAD_TOP + plot - (v / max) * plot;
  const step = W / Math.max(data.length, 1);
  const barWidth = Math.max(3, step - 2);
  const norm = data.length ? data[data.length - 1].norm : 0;
  const active = selected !== null ? data[selected] : null;

  return (
    <figure className="chart">
      <figcaption>
        {active ? `${formatDate(active.date)}: ${active.pages} стр., норма ${active.norm}` : 'Нажмите на столбец, чтобы увидеть день'}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Прочитанные страницы по дням за последние 30 дней">
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--rule)" />
        {norm > 0 && (
          <>
            <line x1="0" x2={W} y1={y(norm)} y2={y(norm)} stroke="var(--gold-ink)" strokeDasharray="3 4" />
            <text x={W} y={y(norm) - 4} textAnchor="end" className="chart-label">норма {norm}</text>
          </>
        )}
        {data.map((d, i) => {
          const barY = y(d.pages);
          const height = Math.max(d.pages > 0 ? 3 : 0, y(0) - barY);
          return (
            <g key={d.date} onClick={() => setSelected(i)}>
              <rect x={i * step} y={PAD_TOP} width={step} height={plot + PAD_BOTTOM} fill="transparent" />
              <rect
                x={i * step + (step - barWidth) / 2}
                y={y(0) - height}
                width={barWidth}
                height={height}
                rx={Math.min(2.5, barWidth / 2)}
                fill={selected === i ? 'var(--gold-ink)' : 'var(--cover-lift)'}
              />
            </g>
          );
        })}
        {data.length > 0 && (
          <>
            <text x="0" y={H - 4} className="chart-label">{formatDate(data[0].date)}</text>
            <text x={W} y={H - 4} textAnchor="end" className="chart-label">{formatDate(data[data.length - 1].date)}</text>
          </>
        )}
      </svg>
    </figure>
  );
}

/** Накопленные страницы: одна линия. */
export function CumulativeLine({ series, offset }: { series: Point[]; offset: number }) {
  const { path, last, max } = useMemo(() => {
    let sum = offset;
    const values = series.map((d) => (sum += d.pages));
    const top = Math.max(10, ...values);
    const plot = H - PAD_TOP - PAD_BOTTOM;
    const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * (W - 4) + 2 : W / 2);
    const y = (v: number) => PAD_TOP + plot - (v / top) * plot;
    return {
      path: values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '),
      last: values.length ? { x: x(values.length - 1), y: y(values[values.length - 1]), value: values[values.length - 1] } : null,
      max: top,
    };
  }, [series, offset]);

  return (
    <figure className="chart">
      <figcaption>Всего прочитано к концу периода: {last?.value ?? 0} стр.</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Накопленное число страниц">
        <line x1="0" x2={W} y1={H - PAD_BOTTOM} y2={H - PAD_BOTTOM} stroke="var(--rule)" />
        <text x="0" y={PAD_TOP + 8} className="chart-label">{max}</text>
        {series.length > 1 && <path d={path} fill="none" stroke="var(--cover-lift)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {last && <circle cx={last.x} cy={last.y} r="4" fill="var(--gold-ink)" stroke="var(--paper)" strokeWidth="2" />}
        {series.length > 0 && (
          <>
            <text x="0" y={H - 4} className="chart-label">{formatDate(series[0].date)}</text>
            <text x={W} y={H - 4} textAnchor="end" className="chart-label">{formatDate(series[series.length - 1].date)}</text>
          </>
        )}
      </svg>
    </figure>
  );
}

/** Полоса активности за последние недели, нажатие открывает день. */
export function ActivityGrid({ series, onSelect }: { series: Point[]; onSelect(date: string): void }) {
  const data = series.slice(-112);
  return (
    <div className="activity" role="group" aria-label="Активность по дням">
      {data.map((d) => (
        <button
          key={d.date}
          type="button"
          className={`activity-cell day-${d.status}`}
          aria-label={`${formatDate(d.date)}: ${d.pages} стр.`}
          onClick={() => onSelect(d.date)}
        />
      ))}
    </div>
  );
}
