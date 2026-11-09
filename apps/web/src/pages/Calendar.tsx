import { addMonths, localDate } from '@khatm/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { DaySheet } from '../components/DaySheet';
import { CalendarLegend, MonthCalendar } from '../components/MonthCalendar';
import { CoverTitle, ErrorState, Loading, Screen } from '../components/ui';
import { api } from '../lib/api';
import { formatMonth } from '../lib/format';
import { useApp } from '../lib/store';
import { useApi } from '../lib/useApi';

export function CalendarPage({ initialMemberId }: { initialMemberId?: string }) {
  const { groupId, membership, version } = useApp();
  const [memberId, setMemberId] = useState(initialMemberId ?? membership.memberId);
  const [month, setMonth] = useState(() => localDate(Intl.DateTimeFormat().resolvedOptions().timeZone).slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi(
    () => api.calendar(groupId, memberId, month),
    [groupId, memberId, month, version],
  );

  const atPresent = data ? month >= data.today.slice(0, 7) : false;

  return (
    <Screen cover={<CoverTitle title="Календарь" subtitle={data?.member.name} />}>
      {data && data.members.length > 1 && (
        <div className="chips scroll-chips">
          {data.members.map((m) => (
            <button
              key={m.memberId}
              type="button"
              className={m.memberId === memberId ? 'chip active' : 'chip'}
              onClick={() => setMemberId(m.memberId)}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
      <div className="month-nav">
        <button type="button" className="icon-btn ink" aria-label="Предыдущий месяц" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={22} />
        </button>
        <h2>{formatMonth(month)}</h2>
        <button
          type="button"
          className="icon-btn ink"
          aria-label="Следующий месяц"
          disabled={atPresent}
          onClick={() => setMonth(addMonths(month, 1))}
        >
          <ChevronRight size={22} />
        </button>
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && <MonthCalendar days={data.days} today={data.today} onSelect={setSelected} />}
      <CalendarLegend />
      <p className="note">Сегодняшний день считается предварительным до его окончания.</p>
      {selected && <DaySheet memberId={memberId} date={selected} onClose={() => setSelected(null)} />}
    </Screen>
  );
}
