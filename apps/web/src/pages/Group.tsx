import type { PersonRef } from '@khatm/shared';
import type { ReactNode } from 'react';
import { CoverTitle, Empty, ErrorState, Loading, Screen, Section } from '../components/ui';
import { api } from '../lib/api';
import { days, formatDate } from '../lib/format';
import { useApp } from '../lib/store';
import { useApi } from '../lib/useApi';

function PeopleRow({ person, right, onOpen }: { person: PersonRef; right?: ReactNode; onOpen(id: string): void }) {
  return (
    <button type="button" className="person-row" onClick={() => onOpen(person.memberId)}>
      <span className="seal seal-plain">{person.name.slice(0, 1)}</span>
      <strong>{person.name}</strong>
      {right && <span className="person-right">{right}</span>}
    </button>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Section title={title}>
      {hint && <p className="muted section-hint">{hint}</p>}
      <div className="list">{children}</div>
    </Section>
  );
}

export function GroupPage() {
  const { groupId, navigate, version } = useApp();
  const { data, error, loading, reload } = useApi(() => api.discipline(groupId), [groupId, version]);
  const open = (memberId: string) => navigate({ name: 'profile', memberId });

  return (
    <Screen cover={<CoverTitle title="Моя группа" subtitle="Идём вместе и поддерживаем друг друга" />}>
      {loading && !data && <Loading />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (
        <>
          <div className="group-summary">
            <div>
              <span className="big-number">{data.pagesToday}</span>
              <span className="muted">страниц группа прочитала сегодня, цель {data.groupGoal}</span>
            </div>
            {data.longestStreak && (
              <p>
                Самая длинная серия: {days(data.longestStreak.days)}, {data.longestStreak.people.map((p) => p.name).join(', ')}
              </p>
            )}
          </div>

          {data.met.length === 0 && data.partial.length === 0 && data.pending.length === 0 && (
            <Empty title="Учёт ещё не начался" text="Как только участники подключатся, здесь появится их день." />
          )}

          {data.met.length > 0 && (
            <Block title="Выполнили норму сегодня">
              {data.met.map((p) => <PeopleRow key={p.memberId} person={p} right={`${p.pages} стр.`} onOpen={open} />)}
            </Block>
          )}
          {data.partial.length > 0 && (
            <Block title="Уже читают сегодня">
              {data.partial.map((p) => <PeopleRow key={p.memberId} person={p} right={`${p.pages} стр.`} onOpen={open} />)}
            </Block>
          )}
          {data.pending.length > 0 && (
            <Block title="Ещё внесут отчёт" hint="День продолжается, отчёт можно внести в любое время.">
              {data.pending.map((p) => <PeopleRow key={p.memberId} person={p} onOpen={open} />)}
            </Block>
          )}
          {data.missedYesterday.length > 0 && (
            <Block title="Вчера норма не отмечена" hint="Если страницы были прочитаны, отчёт можно внести за вчерашнюю дату.">
              {data.missedYesterday.map((p) => <PeopleRow key={p.memberId} person={p} onOpen={open} />)}
            </Block>
          )}
          {data.debts.length > 0 && (
            <Block title="Наверстывают">
              {data.debts.map((p) => <PeopleRow key={p.memberId} person={p} right={`${p.debt} стр.`} onOpen={open} />)}
            </Block>
          )}
          {data.cleared.length > 0 && (
            <Block title="Закрыли долг">
              {data.cleared.map((p) => <PeopleRow key={p.memberId} person={p} right={formatDate(p.date)} onOpen={open} />)}
            </Block>
          )}
          {data.notJoined.length > 0 && (
            <Block title="Ещё не подключились" hint="Отправьте им приглашение в настройках группы.">
              {data.notJoined.map((p) => (
                <div className="person-row" key={p.memberId}>
                  <span className="seal seal-plain">{p.name.slice(0, 1)}</span>
                  <strong>{p.name}</strong>
                </div>
              ))}
            </Block>
          )}
        </>
      )}
    </Screen>
  );
}
