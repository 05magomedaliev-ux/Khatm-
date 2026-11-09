import type {
  AchievementCode, DashboardResponse, RepeatWarningDetails, ReportInput, ReportKind, ReportView, ReportWriteResponse,
} from '@khatm/shared';
import { achievementByCode, addDays, QURAN_PAGES, rangePages } from '@khatm/shared';
import { Minus, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button, CoverTitle, ErrorState, Field, Loading, Screen, Segmented, Sheet } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDate, newRequestId } from '../lib/format';
import { useApp } from '../lib/store';
import { haptic } from '../lib/telegram';
import { useApi } from '../lib/useApi';

const QUICK = [2, 5, 10, 20];

function allocationPreview(pagesCount: number, dashboard: DashboardResponse): string | null {
  if (pagesCount <= 0) return null;
  const { debt, remainingToday } = dashboard.me.stats;
  const toDebt = Math.min(debt, pagesCount);
  const normLeft = Math.max(0, remainingToday - debt);
  const toNorm = Math.min(normLeft, pagesCount - toDebt);
  const extra = pagesCount - toDebt - toNorm;
  const parts: string[] = [];
  if (toDebt > 0) parts.push(`${toDebt} закроют долг`);
  if (toNorm > 0) parts.push(`${toNorm} пойдут в норму дня`);
  if (extra > 0) parts.push(`${extra} сверх нормы`);
  return parts.length ? `${parts.join(', ')}.` : null;
}

export function AddReportPage({ report }: { report?: ReportView }) {
  const { groupId, version, bump, navigate, back } = useApp();
  const { data: dashboard, error: loadError, reload } = useApi(() => api.dashboard(groupId), [groupId, version]);

  const [kind, setKind] = useState<ReportKind>(report?.kind ?? 'count');
  const [count, setCount] = useState(report?.kind === 'count' ? String(report.pages) : '2');
  const [start, setStart] = useState(report?.startPage ? String(report.startPage) : '');
  const [end, setEnd] = useState(report?.endPage ? String(report.endPage) : '');
  const [readOn, setReadOn] = useState<string | null>(report?.readOn ?? null);
  const [note, setNote] = useState(report?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<RepeatWarningDetails | null>(null);
  const [done, setDone] = useState<ReportWriteResponse | null>(null);
  const requestId = useRef(newRequestId());

  const today = dashboard?.today.date;
  const date = readOn ?? today ?? '';
  const startNum = Number(start);
  const endNum = Number(end);
  const rangeValid =
    Number.isInteger(startNum) && Number.isInteger(endNum) && startNum >= 1 && endNum <= QURAN_PAGES && startNum <= endNum && start !== '' && end !== '';
  const pagesCount = kind === 'range' ? (rangeValid ? rangePages(startNum, endNum) : 0) : Number(count) || 0;
  const countValid = Number.isInteger(pagesCount) && pagesCount >= 1 && pagesCount <= QURAN_PAGES;
  const canSubmit = !!date && (kind === 'range' ? rangeValid : countValid);

  function rangeHint(): string | undefined {
    if (start === '' || end === '') return undefined;
    if (startNum < 1 || endNum > QURAN_PAGES) return `Номера страниц должны быть от 1 до ${QURAN_PAGES}.`;
    if (startNum > endNum) return 'Начальная страница должна быть не больше конечной.';
    return undefined;
  }

  async function submit(confirmRepeat = false) {
    setBusy(true);
    setError(null);
    const input: ReportInput = {
      clientRequestId: requestId.current,
      kind,
      readOn: date,
      note: note.trim() || null,
      confirmRepeat,
      ...(kind === 'range' ? { startPage: startNum, endPage: endNum } : { pages: pagesCount }),
    };
    try {
      const result = report ? await api.updateReport(groupId, report.id, input) : await api.createReport(groupId, input);
      haptic.success();
      setWarning(null);
      setDone(result);
      bump();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'repeat_warning') {
        haptic.warning();
        setWarning(e.details as RepeatWarningDetails);
      } else {
        setError(e instanceof ApiError ? e.message : 'Не удалось сохранить отчёт.');
      }
    } finally {
      setBusy(false);
    }
  }

  function resetForNext() {
    requestId.current = newRequestId();
    setDone(null);
    setCount('2');
    setStart('');
    setEnd('');
    setNote('');
  }

  const title = report ? 'Изменить отчёт' : 'Внести результат';

  if (done) {
    return (
      <Screen nav={false} cover={<CoverTitle title={report ? 'Отчёт изменён' : 'Отчёт сохранён'} />}>
        <SuccessPanel result={done} />
        <div className="stack">
          <Button onClick={() => navigate({ name: 'home' })}>На главную</Button>
          {report ? (
            <Button variant="quiet" onClick={back}>Назад</Button>
          ) : (
            <Button variant="quiet" onClick={resetForNext}>Внести ещё один отчёт</Button>
          )}
        </div>
      </Screen>
    );
  }

  const yesterday = today ? addDays(today, -1) : '';
  const startedOn = dashboard?.me.startedOn ?? today ?? '';
  const preview = dashboard && date === today && !report ? allocationPreview(pagesCount, dashboard) : null;

  return (
    <Screen nav={false} cover={<CoverTitle title={title} />}>
      {!dashboard && !loadError && <Loading />}
      {loadError && <ErrorState error={loadError} onRetry={reload} />}
      {dashboard && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit && !busy) void submit();
          }}
        >
          <Segmented
            label="Способ внесения"
            value={kind}
            onChange={(k) => setKind(k)}
            options={[
              { value: 'count', label: 'Количество' },
              { value: 'range', label: 'Диапазон' },
            ]}
          />

          {kind === 'count' ? (
            <>
              <div className="stepper">
                <button type="button" aria-label="Меньше" onClick={() => setCount(String(Math.max(1, pagesCount - 1)))}>
                  <Minus size={22} />
                </button>
                <input
                  inputMode="numeric"
                  aria-label="Количество страниц"
                  value={count}
                  onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
                />
                <button type="button" aria-label="Больше" onClick={() => setCount(String(Math.min(QURAN_PAGES, pagesCount + 1)))}>
                  <Plus size={22} />
                </button>
              </div>
              <div className="chips">
                {QUICK.map((q) => (
                  <button key={q} type="button" className={pagesCount === q ? 'chip active' : 'chip'} onClick={() => setCount(String(q))}>
                    {q}
                  </button>
                ))}
              </div>
              <p className="note">
                В этом режиме приложение не знает номера страниц и не может заметить повторное чтение. Для проверки повторов используйте диапазон.
              </p>
            </>
          ) : (
            <>
              <div className="range-fields">
                <Field label="Со страницы">
                  <input inputMode="numeric" value={start} placeholder="20" onChange={(e) => setStart(e.target.value.replace(/\D/g, '').slice(0, 3))} />
                </Field>
                <Field label="По страницу">
                  <input inputMode="numeric" value={end} placeholder="25" onChange={(e) => setEnd(e.target.value.replace(/\D/g, '').slice(0, 3))} />
                </Field>
              </div>
              {rangeHint() ? (
                <p className="form-error">{rangeHint()}</p>
              ) : (
                <p className="range-total">{rangeValid ? `Всего ${pagesCount} стр., считая обе границы` : 'Укажите первую и последнюю страницу'}</p>
              )}
            </>
          )}

          <div className="date-picker">
            <span className="field-label">Дата чтения</span>
            <div className="chips">
              <button type="button" className={date === today ? 'chip active' : 'chip'} onClick={() => setReadOn(today ?? null)}>
                Сегодня
              </button>
              {yesterday >= startedOn && (
                <button type="button" className={date === yesterday ? 'chip active' : 'chip'} onClick={() => setReadOn(yesterday)}>
                  Вчера
                </button>
              )}
              <input
                className="date-input"
                type="date"
                aria-label="Другая дата"
                value={date}
                min={startedOn}
                max={today}
                onChange={(e) => e.target.value && setReadOn(e.target.value)}
              />
            </div>
          </div>

          <Field label="Заметка, если нужна">
            <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {preview && <p className="preview">Из этих страниц {preview}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}

          <Button type="submit" busy={busy} disabled={!canSubmit}>
            {report ? 'Сохранить изменения' : 'Сохранить отчёт'}
          </Button>
        </form>
      )}

      {warning && (
        <Sheet title="Похоже на повтор" onClose={() => setWarning(null)}>
          {warning.reason === 'range_overlap' ? (
            <>
              <p className="sheet-text">Часть этих страниц уже отмечена:</p>
              <ul className="overlap-list">
                {warning.overlaps.map((o) => (
                  <li key={o.reportId}>
                    {o.overlapStart === o.overlapEnd ? `Страница ${o.overlapStart}` : `Страницы ${o.overlapStart}–${o.overlapEnd}`} в отчёте за {formatDate(o.readOn)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="sheet-text">Только что уже был внесён отчёт с таким же числом страниц за эту дату. Точно проверить повтор в режиме количества нельзя.</p>
          )}
          <div className="stack">
            <Button busy={busy} onClick={() => submit(true)}>Это повторное чтение, сохранить</Button>
            <Button variant="quiet" onClick={() => setWarning(null)}>Вернуться к отчёту</Button>
          </div>
        </Sheet>
      )}
    </Screen>
  );
}

function SuccessPanel({ result }: { result: ReportWriteResponse }) {
  const { report, day, newAchievements, duplicate } = result;
  return (
    <div className="success">
      <svg className="success-star" viewBox="-50 -50 100 100" width="104" height="104" aria-hidden="true">
        <g fill="none" stroke="var(--gold-ink)" strokeWidth="1.5">
          <rect x="-30" y="-30" width="60" height="60" />
          <rect x="-30" y="-30" width="60" height="60" transform="rotate(45)" />
        </g>
        <path d="M-13 1 L-3 11 L15 -10" fill="none" stroke="var(--cover)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="success-value">{report.pages} стр.</p>
      <p className="muted">
        {duplicate ? 'Этот отчёт уже был сохранён, второй раз он не учтён.' : `за ${formatDate(report.readOn)}`}
      </p>
      {day && (
        <dl className="detail-list">
          {day.paidDebt > 0 && <div><dt>Закрыто долга</dt><dd>{day.paidDebt} стр.</dd></div>}
          <div><dt>Зачтено в норму дня</dt><dd>{day.appliedToNorm} из {day.norm} стр.</dd></div>
          {day.surplus > 0 && <div><dt>Сверх нормы</dt><dd>{day.surplus} стр.</dd></div>}
          <div><dt>Долг сейчас</dt><dd>{day.debtAfter} стр.</dd></div>
        </dl>
      )}
      {newAchievements.length > 0 && (
        <div className="new-achievements">
          {newAchievements.map((code: AchievementCode) => (
            <p key={code}>Новое достижение: {achievementByCode(code)?.title}</p>
          ))}
        </div>
      )}
    </div>
  );
}
