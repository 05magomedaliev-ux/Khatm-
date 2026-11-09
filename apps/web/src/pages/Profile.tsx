import { Award, CalendarCheck, Flame, Settings, Target, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { ActivityGrid, CumulativeLine, PagesBars } from '../components/charts';
import { DaySheet } from '../components/DaySheet';
import { CalendarLegend } from '../components/MonthCalendar';
import { Rosette } from '../components/Rosette';
import { Button, ErrorState, Loading, Ornament, Screen, Section, Stat } from '../components/ui';
import { api } from '../lib/api';
import { days, formatDate, number } from '../lib/format';
import { useApp } from '../lib/store';
import { useApi } from '../lib/useApi';

export function ProfilePage({ memberId }: { memberId?: string }) {
  const { groupId, membership, navigate, version } = useApp();
  const target = memberId ?? membership.memberId;
  const { data, error, loading, reload } = useApi(() => api.profile(groupId, target), [groupId, target, version]);
  const [selected, setSelected] = useState<string | null>(null);

  if (!data) {
    return (
      <Screen cover={<div className="cover-title"><h1>Профиль</h1></div>}>
        {loading && <Loading />}
        {error && <ErrorState error={error} onRetry={reload} />}
      </Screen>
    );
  }

  const { stats, member, series } = data;
  const offset = stats.totalPages - series.reduce((sum, d) => sum + d.pages, 0);

  return (
    <Screen
      cover={
        <div className="profile-cover">
          <Rosette value={stats.pagesInCurrent} total={604} size={208} label={`Индивидуальный Хатм: ${stats.percent}%`}>
            <span className="rosette-value small">{stats.percent}%</span>
            <small>осталось {stats.remaining} стр.</small>
          </Rosette>
          <h1>{member.name}</h1>
          {stats.khatmsCompleted > 0 && <p>Завершено Хатмов: {stats.khatmsCompleted}</p>}
          {member.isMe && (
            <div className="profile-links">
              <button type="button" onClick={() => navigate({ name: 'achievements' })}><Award size={16} /> Достижения</button>
              <button type="button" onClick={() => navigate({ name: 'settings' })}><Settings size={16} /> Настройки</button>
            </div>
          )}
        </div>
      }
    >
      <p className="motivation centered">{data.motivation}</p>

      <div className="stat-grid">
        <Stat label="Всего прочитано" value={`${number(stats.totalPages)} стр.`} icon={<TrendingUp size={15} />} />
        <Stat label="Текущий долг" value={`${stats.debt} стр.`} hint={stats.debt === 0 ? 'Долга нет' : 'Закрывается первым'} icon={<Target size={15} />} />
        <Stat label="Серия без пропуска" value={days(stats.currentStreak)} hint={`Лучшая: ${days(stats.bestStreak)}`} icon={<Flame size={15} />} />
        <Stat label="Дней с нормой" value={stats.completedDays} hint={`Из ${days(stats.trackedDays)} учёта`} icon={<CalendarCheck size={15} />} />
        <Stat label="Средний темп" value={`${stats.averagePace} стр.`} hint="в день" />
        <Stat
          label="Лучший день"
          value={stats.bestDay ? `${stats.bestDay.pages} стр.` : 'Пока нет'}
          hint={stats.bestDay ? formatDate(stats.bestDay.date) : undefined}
        />
      </div>

      <div className="forecast">
        <span>Прогноз завершения Хатма</span>
        <strong>{stats.forecastDate ? formatDate(stats.forecastDate, true) : stats.remaining === 0 ? 'Хатм завершён' : 'Нужно ещё несколько дней учёта'}</strong>
      </div>

      <Section title="Результаты">
        <dl className="period-list">
          <div><dt>Сегодня</dt><dd>{stats.today}</dd></div>
          <div><dt>Вчера</dt><dd>{stats.yesterday}</dd></div>
          <div><dt>7 дней</dt><dd>{stats.last7}</dd></div>
          <div><dt>30 дней</dt><dd>{stats.last30}</dd></div>
          <div><dt>Всё время</dt><dd>{stats.totalPages}</dd></div>
        </dl>
      </Section>

      <Ornament />

      <Section title="Чтение по дням">
        {series.length > 0 ? <PagesBars series={series} /> : <p className="muted">Учёт ещё не начался.</p>}
      </Section>

      <Section title="Накопленный итог">
        {series.length > 0 ? <CumulativeLine series={series} offset={offset} /> : <p className="muted">Учёт ещё не начался.</p>}
      </Section>

      <Section title="Календарь активности">
        {series.length > 0 ? (
          <>
            <ActivityGrid series={series} onSelect={setSelected} />
            <CalendarLegend />
          </>
        ) : (
          <p className="muted">Учёт ещё не начался.</p>
        )}
        <Button variant="quiet" onClick={() => navigate({ name: 'calendar', memberId: target })}>
          Открыть календарь
        </Button>
      </Section>

      {selected && <DaySheet memberId={target} date={selected} onClose={() => setSelected(null)} />}
    </Screen>
  );
}
