import type { ReportEventView, ReportSnapshot, ReportView } from '@khatm/shared';
import { History, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatDate, formatDateTime, reportScope } from '../lib/format';
import { useApp } from '../lib/store';
import { Button, Confirm, Sheet } from './ui';

const ACTION: Record<ReportEventView['action'], string> = {
  created: 'Создан',
  updated: 'Изменён',
  deleted: 'Удалён',
};

function snapshot(s: ReportSnapshot | null): string {
  if (!s) return '';
  const scope = s.kind === 'range' ? `стр. ${s.startPage}–${s.endPage}` : `${s.pages} стр.`;
  return `${scope}, ${formatDate(s.readOn)}`;
}

export function ReportSheet({ report, onClose }: { report: ReportView; onClose(): void }) {
  const { groupId, navigate, bump, toast } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<ReportEventView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    try {
      await api.deleteReport(groupId, report.id);
      bump();
      toast('Отчёт удалён');
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось удалить отчёт.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory() {
    try {
      const result = await api.reportHistory(groupId, report.id);
      setEvents(result.events);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить историю.');
    }
  }

  if (confirming) {
    return (
      <Confirm
        title="Удалить отчёт?"
        text={`${report.pages} стр. за ${formatDate(report.readOn)} больше не будут учитываться. Задолженность и рейтинг пересчитаются. Запись останется в истории изменений.`}
        confirmLabel="Удалить отчёт"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <Sheet title={`${report.pages} стр.`} onClose={onClose}>
      <dl className="detail-list">
        <div><dt>Участник</dt><dd>{report.memberName}</dd></div>
        <div><dt>Дата чтения</dt><dd>{formatDate(report.readOn, true)}</dd></div>
        <div><dt>Что отмечено</dt><dd>{reportScope(report)}</dd></div>
        {report.note && <div><dt>Заметка</dt><dd>{report.note}</dd></div>}
        <div><dt>Внесён</dt><dd>{formatDateTime(report.createdAt)}</dd></div>
      </dl>
      {report.kind === 'count' && (
        <p className="note">Номера страниц не указаны, поэтому такой отчёт нельзя проверить на повторы.</p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="stack">
        {report.canEdit && (
          <>
            <Button
              variant="quiet"
              onClick={() => {
                onClose();
                navigate({ name: 'add', report });
              }}
            >
              <Pencil size={16} /> Изменить отчёт
            </Button>
            <Button variant="quiet" className="text-danger" onClick={() => setConfirming(true)}>
              <Trash2 size={16} /> Удалить отчёт
            </Button>
          </>
        )}
        {events === null && (
          <Button variant="quiet" onClick={loadHistory}>
            <History size={16} /> Показать историю изменений
          </Button>
        )}
      </div>
      {events && (
        <ol className="history">
          {events.map((event) => (
            <li key={event.id}>
              <strong>{ACTION[event.action]}</strong>
              <span>{formatDateTime(event.createdAt)}{event.actorName ? `, ${event.actorName}` : ''}</span>
              {event.action === 'updated' && (
                <small>Было: {snapshot(event.before)}. Стало: {snapshot(event.after)}.</small>
              )}
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}
