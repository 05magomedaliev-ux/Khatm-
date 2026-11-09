import { DEBT_RATING_CAP_NORMS, STREAK_RATING_CAP_DAYS } from '@khatm/shared';
import { useState } from 'react';
import { CoverTitle, Empty, ErrorState, Loading, Screen, Segmented } from '../components/ui';
import { api } from '../lib/api';
import { days, number } from '../lib/format';
import { useApp } from '../lib/store';
import { useApi } from '../lib/useApi';

function Rank({ rank }: { rank: number | null }) {
  if (rank === null) return <span className="rank rank-none" aria-label="Без места">—</span>;
  return <span className={`rank${rank <= 3 ? ' rank-top' : ''}`}>{rank}</span>;
}

export function RatingPage() {
  const { groupId, navigate, version } = useApp();
  const [tab, setTab] = useState<'pages' | 'discipline'>('pages');
  const { data, error, loading, reload } = useApi(() => api.leaderboards(groupId), [groupId, version]);
  const open = (memberId: string) => navigate({ name: 'profile', memberId });

  return (
    <Screen cover={<CoverTitle title="Рейтинг" />}>
      <Segmented
        label="Вид рейтинга"
        value={tab}
        onChange={(v) => setTab(v)}
        options={[
          { value: 'pages', label: 'По страницам' },
          { value: 'discipline', label: 'Дисциплина' },
        ]}
      />
      {loading && !data && <Loading />}
      {error && <ErrorState error={error} onRetry={reload} />}

      {data && tab === 'pages' && (
        <div className="list rank-list">
          {data.pages.every((r) => r.rank === null) && (
            <Empty title="Места появятся после первых отчётов" />
          )}
          {data.pages.map((row) => (
            <button type="button" key={row.memberId} className={`rank-row${row.isMe ? ' me' : ''}`} onClick={() => open(row.memberId)}>
              <Rank rank={row.rank} />
              <span className="rank-main">
                <strong>{row.name}</strong>
                <small>{row.rank === null ? 'Пока без отчётов' : `${row.percent}% Хатма`}</small>
              </span>
              <span className="rank-value">{number(row.totalPages)}<small> стр.</small></span>
            </button>
          ))}
        </div>
      )}

      {data && tab === 'discipline' && (
        <>
          <div className="list rank-list">
            {data.discipline.every((r) => r.rank === null) && (
              <Empty title="Рейтинг появится завтра" text="Дисциплина считается только по завершённым дням." />
            )}
            {data.discipline.map((row) => (
              <button type="button" key={row.memberId} className={`rank-row${row.isMe ? ' me' : ''}`} onClick={() => open(row.memberId)}>
                <Rank rank={row.rank} />
                <span className="rank-main">
                  <strong>{row.name}</strong>
                  <small>
                    {row.score === null
                      ? 'Пока нет завершённых дней'
                      : `Норма в ${row.completion}% дней, серия ${days(row.closedStreak)}, долг ${row.closedDebt} стр.`}
                  </small>
                </span>
                <span className="rank-value">{row.score ?? ''}</span>
              </button>
            ))}
          </div>
          <details className="explain">
            <summary>Как считается дисциплина</summary>
            <p>Итог складывается так: 70% даёт доля дней с выполненной нормой, 20% — текущая серия (учитывается до {STREAK_RATING_CAP_DAYS} дней), 10% — отсутствие долга (долг в {DEBT_RATING_CAP_NORMS} дневных норм даёт 0).</p>
            <p>Сегодняшний день не учитывается, пока он не завершился. Участники без завершённых дней места не получают.</p>
          </details>
        </>
      )}
    </Screen>
  );
}
