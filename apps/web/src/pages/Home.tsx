import type { ReportView } from '@khatm/shared';
import { Award, ChevronDown, Plus, Settings } from 'lucide-react';
import { useState } from 'react';
import { ReportRow } from '../components/ReportRow';
import { ReportSheet } from '../components/ReportSheet';
import { Rosette } from '../components/Rosette';
import { Button, Empty, ErrorState, Loading, Screen, Seal, Section, Sheet } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, number, people } from '../lib/format';
import { useApp } from '../lib/store';
import { useApi } from '../lib/useApi';

export function HomePage() {
  const { groupId, me, navigate, selectGroup, version } = useApp();
  const { data, error, loading, reload } = useApi(() => api.dashboard(groupId), [groupId, version]);
  const [opened, setOpened] = useState<ReportView | null>(null);
  const [switching, setSwitching] = useState(false);

  const header = (
    <div className="home-top">
      <button
        type="button"
        className="group-name"
        disabled={me.memberships.length < 2}
        onClick={() => setSwitching(true)}
      >
        <span>{data?.group.name ?? me.memberships.find((m) => m.groupId === groupId)?.groupName}</span>
        {me.memberships.length > 1 && <ChevronDown size={18} />}
      </button>
      <div className="home-actions">
        <button type="button" className="icon-btn" aria-label="Достижения" onClick={() => navigate({ name: 'achievements' })}>
          <Award size={21} strokeWidth={1.6} />
        </button>
        <button type="button" className="icon-btn" aria-label="Настройки" onClick={() => navigate({ name: 'settings' })}>
          <Settings size={21} strokeWidth={1.6} />
        </button>
        <button type="button" className="avatar" aria-label="Мой профиль" onClick={() => navigate({ name: 'profile' })}>
          {me.user.photoUrl ? <img src={me.user.photoUrl} alt="" /> : me.user.firstName.slice(0, 1)}
        </button>
      </div>
    </div>
  );

  if (!data) {
    return (
      <Screen cover={header}>
        {loading && <Loading />}
        {error && <ErrorState error={error} onRetry={reload} />}
      </Screen>
    );
  }

  const { progress, today, me: mine } = data;

  return (
    <Screen
      cover={
        <>
          {header}
          <div className="hero">
            <Rosette
              value={progress.countedPages}
              total={progress.goalPages}
              label={`Группа прочитала ${progress.percent}% общей цели`}
            >
              <span className="rosette-value">{progress.percent}%</span>
              <small>
                {number(progress.totalPages)} из {number(progress.goalPages)} стр.
              </small>
            </Rosette>
            <p className="hero-caption">{people(progress.memberCount)}, по 604 страницы на каждого</p>
          </div>
        </>
      }
    >
      <Section title="Сегодня" aside={<span className="muted">{formatDate(today.date)}</span>}>
        <div className="today-group">
          <div className="seals">
            {today.members.map((m) => (
              <Seal key={m.memberId} name={m.name} status={m.status} />
            ))}
          </div>
          <p className="today-status">
            {today.startedCount === 0
              ? 'Участники ещё не начали учёт'
              : `Норму выполнили ${today.metCount} из ${today.startedCount}`}
          </p>
          <dl className="inline-stats">
            <div>
              <dt>Цель дня</dt>
              <dd>{today.groupGoal} стр.</dd>
              <small>по {today.dailyMinimum} на каждого</small>
            </div>
            <div>
              <dt>Прочитано сегодня</dt>
              <dd>{today.pages} стр.</dd>
              <small>{today.reportedCount} с отчётом</small>
            </div>
          </dl>
          <p className="note">Итог дня предварительный, пока день не завершился.</p>
        </div>
      </Section>

      <Section title="Мой день">
        <div className="my-day">
          <p className="my-day-main">
            {mine.stats.todayMet
              ? 'Норма на сегодня выполнена'
              : mine.stats.remainingToday > 0
                ? `Осталось ${mine.stats.remainingToday} стр.`
                : 'Норма на сегодня выполнена'}
          </p>
          <p className="muted">
            Сегодня {mine.stats.today} стр.
            {mine.stats.debt > 0 ? `, сначала закрывается долг ${mine.stats.debt} стр.` : ''}
          </p>
          <p className="motivation">{data.motivation}</p>
          <Button onClick={() => navigate({ name: 'add' })}>
            <Plus size={18} /> Внести результат
          </Button>
        </div>
      </Section>

      <Section title="Последние отчёты">
        {data.recentReports.length === 0 ? (
          <Empty title="Отчётов пока нет" text="Внесите первый результат, и он появится здесь." />
        ) : (
          <div className="list">
            {data.recentReports.map((report) => (
              <ReportRow key={report.id} report={report} onOpen={setOpened} />
            ))}
          </div>
        )}
      </Section>

      {opened && <ReportSheet report={opened} onClose={() => setOpened(null)} />}
      {switching && (
        <Sheet title="Мои группы" onClose={() => setSwitching(false)}>
          <div className="choice-list">
            {me.memberships.map((m) => (
              <button
                key={m.groupId}
                type="button"
                className={`choice${m.groupId === groupId ? ' selected' : ''}`}
                onClick={() => {
                  selectGroup(m.groupId);
                  setSwitching(false);
                }}
              >
                {m.groupName}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </Screen>
  );
}
