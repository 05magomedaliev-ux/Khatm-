import type { MemberNotificationSettings } from '@khatm/shared';
import { DEFAULT_DAILY_MINIMUM, QURAN_PAGES } from '@khatm/shared';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, CoverTitle, ErrorState, Field, Loading, Screen, Section, Toggle } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/store';
import { useApi } from '../lib/useApi';

export function SettingsPage() {
  const { groupId, me, membership, navigate, selectGroup, reloadMe, toast } = useApp();
  const { data, error, loading, reload } = useApi(() => api.notifications(groupId), [groupId]);
  const [form, setForm] = useState<MemberNotificationSettings | null>(null);
  const [creating, setCreating] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  async function save(patch: Partial<MemberNotificationSettings>) {
    if (!form) return;
    const next = { ...form, ...patch };
    setForm(next);
    setMessage(null);
    try {
      const { groupReminderTime: _ignored, ...input } = next;
      setForm(await api.updateNotifications(groupId, input));
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Не удалось сохранить настройки.');
      setForm(form);
    }
  }

  async function createGroup() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.createGroup({
        name: groupName.trim(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow',
        dailyMinimum: DEFAULT_DAILY_MINIMUM,
        displayName: me.user.firstName,
      });
      await reloadMe();
      selectGroup(result.groupId);
      toast('Группа создана');
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Не удалось создать группу.');
    } finally {
      setBusy(false);
    }
  }

  const isAdmin = membership.role === 'owner' || membership.role === 'admin';

  return (
    <Screen nav={false} cover={<CoverTitle title="Настройки" subtitle={membership.groupName} />}>
      {isAdmin && (
        <button type="button" className="admin-link" onClick={() => navigate({ name: 'admin' })}>
          <ShieldCheck size={20} />
          <span>
            <strong>Управление группой</strong>
            <small>Участники, приглашения, норма, отчёты и уведомления</small>
          </span>
        </button>
      )}

      <Section title="Мои уведомления">
        {loading && !form && <Loading />}
        {error && <ErrorState error={error} onRetry={reload} />}
        {form && (
          <div className="settings-block">
            <Toggle
              label="Напоминать о чтении"
              hint="Придёт, только если норма на сегодня ещё не выполнена"
              checked={form.remindersEnabled}
              onChange={(v) => save({ remindersEnabled: v })}
            />
            <Field label="Время напоминания" hint={`Если не указать, используется время группы: ${form.groupReminderTime}`}>
              <div className="time-row">
                <input
                  type="time"
                  value={form.reminderTime ?? ''}
                  disabled={!form.remindersEnabled}
                  onChange={(e) => e.target.value && save({ reminderTime: e.target.value })}
                />
                {form.reminderTime && (
                  <Button variant="quiet" onClick={() => save({ reminderTime: null })}>Как у группы</Button>
                )}
              </div>
            </Field>
            <Toggle label="Итоги дня" hint="Если чат группы не подключён, итоги придут в личные сообщения" checked={form.dailyReportEnabled} onChange={(v) => save({ dailyReportEnabled: v })} />
            <Toggle label="Новые достижения" checked={form.achievementsEnabled} onChange={(v) => save({ achievementsEnabled: v })} />
          </div>
        )}
        {message && <p className="form-error" role="alert">{message}</p>}
      </Section>

      <Section title="Мои группы">
        <div className="choice-list">
          {me.memberships.map((m) => (
            <button
              key={m.groupId}
              type="button"
              className={`choice${m.groupId === groupId ? ' selected' : ''}`}
              onClick={() => selectGroup(m.groupId)}
            >
              {m.groupName}
            </button>
          ))}
        </div>
        {creating ? (
          <div className="stack">
            <Field label="Название новой группы">
              <input value={groupName} maxLength={60} onChange={(e) => setGroupName(e.target.value)} />
            </Field>
            <Button busy={busy} disabled={!groupName.trim()} onClick={createGroup}>Создать группу</Button>
          </div>
        ) : (
          <Button variant="quiet" onClick={() => setCreating(true)}>Создать новую группу</Button>
        )}
      </Section>

      <Section title="Правила учёта">
        <ul className="rules">
          <li>Полный Коран в приложении — {QURAN_PAGES} страницы.</li>
          <li>У каждого дня своя норма. Излишек на будущие дни не переносится.</li>
          <li>Лишние страницы сначала закрывают долг, затем идут в норму дня.</li>
          <li>Сегодняшний день предварительный: итог подводится после его окончания.</li>
          <li>Отчёты можно внести и исправить задним числом, долг пересчитается сам.</li>
        </ul>
      </Section>
    </Screen>
  );
}
