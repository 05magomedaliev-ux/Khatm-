import type { AdminResponse, GroupSettingsView, InviteView, MemberAdminView, ReportView } from '@khatm/shared';
import { Ban, Copy, Link2, Send, Share2, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ReportRow } from '../components/ReportRow';
import { ReportSheet } from '../components/ReportSheet';
import { Button, Confirm, CoverTitle, ErrorState, Field, Loading, Screen, Section, Sheet, Toggle } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/store';
import { shareLink } from '../lib/telegram';
import { useApi } from '../lib/useApi';

const ZONES = [
  'Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Krasnoyarsk',
  'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka', 'Europe/Istanbul',
  'Asia/Dubai', 'Asia/Baku', 'Asia/Almaty', 'Asia/Tashkent', 'UTC',
];

const ROLE: Record<string, string> = { owner: 'Владелец', admin: 'Администратор', member: 'Участник' };

export function AdminPage() {
  const { groupId, version, bump, toast, reloadMe } = useApp();
  const { data, error, loading, reload } = useApi(() => api.admin(groupId), [groupId, version]);
  const reports = useApi(() => api.reports(groupId, { limit: 30 }), [groupId, version]);
  const [settings, setSettings] = useState<GroupSettingsView | null>(null);
  const [member, setMember] = useState<MemberAdminView | null>(null);
  const [report, setReport] = useState<ReportView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newMember, setNewMember] = useState('');

  useEffect(() => {
    if (data) setSettings(data.settings);
  }, [data]);

  async function act(key: string, action: () => Promise<unknown>, success?: string) {
    setBusy(key);
    setMessage(null);
    try {
      await action();
      bump();
      if (success) toast(success);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Не удалось выполнить действие.');
    } finally {
      setBusy(null);
    }
  }

  function saveSettings() {
    if (!settings) return;
    return act(
      'settings',
      async () => {
        await api.updateSettings(groupId, {
          name: settings.name.trim(),
          timezone: settings.timezone,
          dailyMinimum: settings.dailyMinimum,
          reminderTime: settings.reminderTime,
          reportTime: settings.reportTime,
          remindersEnabled: settings.remindersEnabled,
          reportsEnabled: settings.reportsEnabled,
        });
        await reloadMe();
      },
      'Настройки группы сохранены',
    );
  }

  const zones = settings && !ZONES.includes(settings.timezone) ? [settings.timezone, ...ZONES] : ZONES;

  return (
    <Screen nav={false} cover={<CoverTitle title="Управление группой" subtitle={settings?.name} />}>
      {loading && !data && <Loading />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {message && <p className="form-error" role="alert">{message}</p>}
      {data && settings && (
        <>
          <Section title="Приглашения">
            <div className="list">
              {data.invites.map((invite) => (
                <InviteRow key={invite.id} invite={invite} onRevoke={() => act(`rev-${invite.id}`, () => api.revokeInvite(groupId, invite.id), 'Приглашение отключено')} />
              ))}
            </div>
            <Button variant="quiet" busy={busy === 'invite'} onClick={() => act('invite', () => api.createInvite(groupId), 'Приглашение создано')}>
              <Link2 size={16} /> Создать приглашение
            </Button>
          </Section>

          <Section title="Участники">
            <div className="list">
              {data.members.map((m) => (
                <button type="button" className="person-row" key={m.memberId} onClick={() => setMember(m)}>
                  <span className="seal seal-plain">{m.name.slice(0, 1)}</span>
                  <span className="person-main">
                    <strong>{m.name}</strong>
                    <small>
                      {ROLE[m.role]}
                      {!m.claimed ? ', ещё не подключился' : ''}
                      {m.status === 'blocked' ? ', заблокирован' : ''}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <div className="inline-form">
              <input aria-label="Имя нового участника" placeholder="Имя участника" maxLength={40} value={newMember} onChange={(e) => setNewMember(e.target.value)} />
              <Button
                variant="quiet"
                disabled={!newMember.trim()}
                busy={busy === 'add'}
                onClick={() =>
                  act('add', async () => {
                    await api.addMember(groupId, newMember.trim());
                    setNewMember('');
                  }, 'Участник добавлен')
                }
              >
                <UserPlus size={16} /> Добавить
              </Button>
            </div>
            <p className="note">Добавленный участник подключится сам: откроет приглашение и выберет своё имя.</p>
          </Section>

          <Section title="Группа и норма">
            <div className="stack">
              <Field label="Название">
                <input value={settings.name} maxLength={60} onChange={(e) => setSettings({ ...settings, name: e.target.value })} />
              </Field>
              <Field label="Страниц в день" hint="Новая норма действует с сегодняшнего дня. Прошедшие дни не пересчитываются.">
                <input
                  inputMode="numeric"
                  value={settings.dailyMinimum || ''}
                  onChange={(e) => setSettings({ ...settings, dailyMinimum: Number(e.target.value.replace(/\D/g, '').slice(0, 3)) })}
                />
              </Field>
              <Field label="Часовой пояс" hint="Определяет, когда для группы заканчивается день.">
                <select value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}>
                  {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <Section title="Уведомления">
            <div className="settings-block">
              <Toggle label="Ежедневные напоминания" checked={settings.remindersEnabled} onChange={(v) => setSettings({ ...settings, remindersEnabled: v })} />
              <Field label="Время напоминания">
                <input type="time" value={settings.reminderTime} onChange={(e) => e.target.value && setSettings({ ...settings, reminderTime: e.target.value })} />
              </Field>
              <Toggle label="Итоги дня" checked={settings.reportsEnabled} onChange={(v) => setSettings({ ...settings, reportsEnabled: v })} />
              <Field label="Время итогов">
                <input type="time" value={settings.reportTime} onChange={(e) => e.target.value && setSettings({ ...settings, reportTime: e.target.value })} />
              </Field>
            </div>
            <Button busy={busy === 'settings'} disabled={!settings.name.trim() || settings.dailyMinimum < 1} onClick={saveSettings}>
              Сохранить настройки группы
            </Button>
          </Section>

          <Section title="Чат группы в Telegram">
            {settings.chatLinked ? (
              <div className="stack">
                <p className="lead">Подключён чат «{settings.chatTitle}». Итоги дня и статистика публикуются там.</p>
                <Button busy={busy === 'publish'} onClick={() => act('publish', () => api.publishStats(groupId), 'Статистика опубликована')}>
                  <Send size={16} /> Опубликовать статистику
                </Button>
                <Button variant="quiet" onClick={() => act('unlink', () => api.unlinkChat(groupId), 'Чат отключён')}>Отключить чат</Button>
              </div>
            ) : (
              <div className="stack">
                <p className="muted">Добавьте бота в чат и отправьте там команду ниже.</p>
                {data.settings.linkCode && (
                  <code className="link-code">/link {data.settings.linkCode}</code>
                )}
                <Button variant="quiet" busy={busy === 'code'} onClick={() => act('code', () => api.createLinkCode(groupId))}>
                  {data.settings.linkCode ? 'Получить новый код' : 'Получить код подключения'}
                </Button>
              </div>
            )}
          </Section>

          <Section title="Отчёты участников">
            {reports.data?.reports.length === 0 && <p className="muted">Отчётов пока нет.</p>}
            <div className="list">
              {reports.data?.reports.map((r) => <ReportRow key={r.id} report={r} onOpen={setReport} />)}
            </div>
          </Section>
        </>
      )}
      {member && data && (
        <MemberSheet
          member={member}
          myRole={data.myRole}
          onClose={() => setMember(null)}
          onChange={async (input, success) => {
            await act(`member`, () => api.updateMember(groupId, member.memberId, input), success);
            setMember(null);
          }}
        />
      )}
      {report && <ReportSheet report={report} onClose={() => setReport(null)} />}
    </Screen>
  );
}

function InviteRow({ invite, onRevoke }: { invite: InviteView; onRevoke(): void }) {
  const { toast } = useApp();
  return (
    <div className="invite-row">
      <span className="invite-link">{invite.link.replace('https://', '')}</span>
      <small>Использовано: {invite.usedCount}</small>
      <div className="invite-actions">
        <button
          type="button"
          className="icon-btn ink"
          aria-label="Скопировать ссылку"
          onClick={() => {
            void navigator.clipboard?.writeText(invite.link).then(() => toast('Ссылка скопирована'));
          }}
        >
          <Copy size={18} />
        </button>
        <button type="button" className="icon-btn ink" aria-label="Отправить ссылку" onClick={() => shareLink(invite.link, 'Присоединяйтесь к нашему Хатму')}>
          <Share2 size={18} />
        </button>
        <button type="button" className="icon-btn ink" aria-label="Отключить приглашение" onClick={onRevoke}>
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
}

function MemberSheet({
  member,
  myRole,
  onClose,
  onChange,
}: {
  member: MemberAdminView;
  myRole: AdminResponse['myRole'];
  onClose(): void;
  onChange(input: Parameters<typeof api.updateMember>[2], success: string): Promise<void>;
}) {
  const [confirm, setConfirm] = useState<'block' | 'remove' | null>(null);
  const [name, setName] = useState(member.name);
  const [startedOn, setStartedOn] = useState(member.startedOn ?? '');

  if (confirm) {
    const remove = confirm === 'remove';
    return (
      <Confirm
        title={remove ? 'Удалить участника?' : 'Заблокировать участника?'}
        text={
          remove
            ? `${member.name} исчезнет из группы, а общая цель уменьшится на 604 страницы. Отчёты сохранятся в базе.`
            : `${member.name} не сможет открывать группу, пока вы не снимете блокировку.`
        }
        confirmLabel={remove ? 'Удалить участника' : 'Заблокировать участника'}
        danger
        onConfirm={() =>
          onChange({ status: remove ? 'removed' : 'blocked' }, remove ? 'Участник удалён' : 'Участник заблокирован')
        }
        onCancel={() => setConfirm(null)}
      />
    );
  }

  const isOwner = member.role === 'owner';

  return (
    <Sheet title={member.name} onClose={onClose}>
      <div className="stack">
        <Field label="Имя в группе">
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Начало учёта" hint="Дни до этой даты не создают задолженность.">
          <input type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />
        </Field>
        <Button
          variant="quiet"
          disabled={!name.trim()}
          onClick={() =>
            onChange({ displayName: name.trim(), ...(startedOn ? { startedOn } : {}) }, 'Изменения сохранены')
          }
        >
          Сохранить
        </Button>
        {myRole === 'owner' && !isOwner && member.claimed && (
          <Button
            variant="quiet"
            onClick={() =>
              onChange(
                { role: member.role === 'admin' ? 'member' : 'admin' },
                member.role === 'admin' ? 'Права администратора сняты' : 'Назначен администратор',
              )
            }
          >
            {member.role === 'admin' ? 'Снять права администратора' : 'Назначить администратором'}
          </Button>
        )}
        {!isOwner && (
          <>
            {member.status === 'blocked' ? (
              <Button variant="quiet" onClick={() => onChange({ status: 'active' }, 'Блокировка снята')}>Снять блокировку</Button>
            ) : (
              <Button variant="quiet" className="text-danger" onClick={() => setConfirm('block')}>
                <Ban size={16} /> Заблокировать
              </Button>
            )}
            <Button variant="quiet" className="text-danger" onClick={() => setConfirm('remove')}>
              <UserMinus size={16} /> Удалить из группы
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
