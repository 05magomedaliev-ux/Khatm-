import type { LedgerDay, ReportView } from '@khatm/shared';
import { useState } from 'react';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useApp } from '../lib/store';
import { useApi } from '../lib/useApi';
import { ReportRow } from './ReportRow';
import { ReportSheet } from './ReportSheet';
import { ErrorState, Loading, Sheet } from './ui';

export const STATUS_TEXT = {
  met: 'Норма выполнена',
  partial: 'Прочитано, норма не выполнена',
  missed: 'День завершился без выполнения нормы',
  none: 'Данных нет',
} as const;

function statusText(entry: LedgerDay): string {
  if (entry.provisional && !entry.normMet) {
    return entry.pages > 0 ? 'День ещё идёт, норма пока не выполнена' : 'День ещё идёт, отчёта пока нет';
  }
  return STATUS_TEXT[entry.status];
}

export function DaySheet({ memberId, date, onClose }: { memberId: string; date: string; onClose(): void }) {
  const { groupId, version } = useApp();
  const { data, error, loading, reload } = useApi(() => api.day(groupId, memberId, date), [groupId, memberId, date, version]);
  const [opened, setOpened] = useState<ReportView | null>(null);

  if (opened) return <ReportSheet report={opened} onClose={() => setOpened(null)} />;

  return (
    <Sheet title={formatDate(date, true)} onClose={onClose}>
      {loading && !data && <Loading />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (
        <>
          <p className="sheet-lead">{data.member.name}</p>
          {data.entry ? (
            <>
              <p className={`status-line status-${data.entry.status}`}>{statusText(data.entry)}</p>
              <dl className="detail-list">
                <div><dt>Прочитано</dt><dd>{data.entry.pages} стр.</dd></div>
                <div><dt>Норма дня</dt><dd>{data.entry.norm} стр.</dd></div>
                <div><dt>Долг на начало дня</dt><dd>{data.entry.debtBefore} стр.</dd></div>
                <div><dt>Закрыто долга</dt><dd>{data.entry.paidDebt} стр.</dd></div>
                <div><dt>Зачтено в норму</dt><dd>{data.entry.appliedToNorm} стр.</dd></div>
                <div><dt>Сверх нормы</dt><dd>{data.entry.surplus} стр.</dd></div>
                <div>
                  <dt>{data.entry.provisional ? 'Долг сейчас' : 'Долг на конец дня'}</dt>
                  <dd>{data.entry.debtAfter} стр.</dd>
                </div>
              </dl>
              {data.entry.provisional && <p className="note">Итог станет окончательным после завершения дня.</p>}
            </>
          ) : (
            <p className="status-line status-none">Этот день вне периода учёта.</p>
          )}
          <p className="sheet-group">
            Вся группа в этот день: {data.groupPages} стр., норму выполнили {data.groupMet} из {data.groupStarted}.
          </p>
          {data.reports.length > 0 && (
            <div className="list">
              {data.reports.map((report) => (
                <ReportRow key={report.id} report={report} onOpen={setOpened} />
              ))}
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
