import { JUZ_COUNT } from '@khatm/shared';
import type { ReactNode } from 'react';

const INNER = 96;
const MID = 124;
const OUTER = 146;
const HALF_WIDTH = 11.6;
const STEP = 360 / JUZ_COUNT;
const PETAL = `M0,${-INNER} L${HALF_WIDTH},${-MID} L0,${-OUTER} L${-HALF_WIDTH},${-MID} Z`;

/**
 * Главный образ приложения: розетка из 30 лепестков, по одному на джуз.
 * Лепестки заполняются по порядку; последний заполняется частично.
 */
export function Rosette({
  value,
  total,
  size = 280,
  label,
  children,
}: {
  value: number;
  total: number;
  size?: number;
  label: string;
  children: ReactNode;
}) {
  const fraction = total > 0 ? Math.min(1, value / total) : 0;
  const filled = fraction * JUZ_COUNT;

  return (
    <div className="rosette" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox="-150 -150 300 300" width={size} height={size} aria-hidden="true">
        <circle r={INNER - 6} fill="none" stroke="var(--gold)" strokeOpacity=".55" strokeWidth=".8" />
        <g fill="none" stroke="var(--gold)" strokeOpacity=".28" strokeWidth=".8">
          <rect x="-62" y="-62" width="124" height="124" />
          <rect x="-62" y="-62" width="124" height="124" transform="rotate(45)" />
        </g>
        {Array.from({ length: JUZ_COUNT }, (_, i) => {
          const level = Math.max(0, Math.min(1, filled - i));
          const clipId = `petal-clip-${size}-${i}`;
          return (
            <g key={i} transform={`rotate(${i * STEP})`}>
              <path d={PETAL} fill="var(--petal-empty)" stroke="var(--gold)" strokeOpacity=".42" strokeWidth=".8" />
              {level > 0 && (
                <>
                  {level < 1 && (
                    <clipPath id={clipId}>
                      <rect x="-14" y={-INNER - (OUTER - INNER) * level} width="28" height={(OUTER - INNER) * level} />
                    </clipPath>
                  )}
                  <path
                    className="petal-fill"
                    style={{ ['--i' as string]: i }}
                    d={PETAL}
                    fill="var(--gold)"
                    clipPath={level < 1 ? `url(#${clipId})` : undefined}
                  />
                </>
              )}
            </g>
          );
        })}
      </svg>
      <div className="rosette-center">{children}</div>
    </div>
  );
}
