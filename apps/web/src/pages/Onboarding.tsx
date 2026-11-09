import type { InvitePreview, MeResponse } from '@khatm/shared';
import { DEFAULT_DAILY_MINIMUM, DEFAULT_TIMEZONE } from '@khatm/shared';
import { useEffect, useState } from 'react';
import { Rosette } from '../components/Rosette';
import { Button, ErrorState, Field, Loading } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { people } from '../lib/format';
import { haptic } from '../lib/telegram';

export function OnboardingPage({
  me,
  inviteCode,
  onDone,
  onDismissInvite,
  onEnterCode,
}: {
  me: MeResponse;
  inviteCode: string | null;
  onDone(): Promise<void>;
  onDismissInvite(): void;
  onEnterCode(code: string): void;
}) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'choose' | 'create' | 'code'>('choose');
  const [name, setName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [newName, setNewName] = useState(me.user.firstName);
  const [code, setCode] = useState('');
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!inviteCode) return;
    api
      .invitePreview(inviteCode)
      .then((p) => {
        if (p.alreadyMember) void onDone();
        else {
          setPreview(p);
          setPicking(p.unclaimed.length > 0);
        }
      })
      .catch((e: ApiError) => setLoadError(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      haptic.success();
      await onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось выполнить действие.');
      setBusy(false);
    }
  }

  const cover = (
    <header className="cover cover-welcome">
      <Rosette value={0} total={604} size={190} label="Розетка из тридцати джузов">
        <span className="rosette-mark">30</span>
        <small>джузов</small>
      </Rosette>
      <h1>Хатм — наш путь</h1>
      <p>Читаем Коран вместе, по несколько страниц каждый день.</p>
    </header>
  );

  if (inviteCode) {
    return (
      <div className="screen">
        {cover}
        <main className="page">
          {!preview && !loadError && <Loading />}
          {loadError && (
            <div className="stack">
              <ErrorState error={loadError} />
              {me.memberships.length > 0 ? (
                <Button variant="quiet" onClick={onDismissInvite}>Перейти в приложение</Button>
              ) : (
                <Button variant="quiet" onClick={onDismissInvite}>Создать свою группу</Button>
              )}
            </div>
          )}
          {preview && (
            <>
              <h2 className="welcome-title">{preview.groupName}</h2>
              <p className="muted">{people(preview.memberCount)} в группе</p>
              {picking ? (
                <>
                  <p className="lead">Выберите себя в списке. Учёт начнётся с сегодняшнего дня, с нуля.</p>
                  <div className="choice-list">
                    {preview.unclaimed.map((person) => (
                      <button
                        key={person.memberId}
                        type="button"
                        className="choice"
                        disabled={busy}
                        onClick={() => run(() => api.joinInvite(inviteCode, { memberId: person.memberId }))}
                      >
                        {person.name}
                      </button>
                    ))}
                  </div>
                  <Button variant="quiet" onClick={() => setPicking(false)}>Меня нет в списке</Button>
                </>
              ) : (
                <div className="stack">
                  <Field label="Как вас показывать в группе">
                    <input value={newName} maxLength={40} onChange={(e) => setNewName(e.target.value)} />
                  </Field>
                  <Button
                    busy={busy}
                    disabled={!newName.trim()}
                    onClick={() => run(() => api.joinInvite(inviteCode, { displayName: newName.trim() }))}
                  >
                    Присоединиться к группе
                  </Button>
                </div>
              )}
              {error && <p className="form-error" role="alert">{error}</p>}
            </>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="screen">
      {cover}
      <main className="page">
        {mode === 'choose' && (
          <div className="stack">
            <p className="lead">Группа — это несколько человек с общей целью. Каждый ведёт свой учёт, а прогресс складывается в общий.</p>
            <Button onClick={() => setMode('create')}>Создать группу</Button>
            <Button variant="quiet" onClick={() => setMode('code')}>У меня есть приглашение</Button>
          </div>
        )}
        {mode === 'create' && (
          <div className="stack">
            <Field label="Название группы">
              <input value={groupName} maxLength={60} placeholder="Например, Семья" onChange={(e) => setGroupName(e.target.value)} />
            </Field>
            <Field label="Как вас показывать в группе">
              <input value={name || me.user.firstName} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button
              busy={busy}
              disabled={!groupName.trim()}
              onClick={() =>
                run(() =>
                  api.createGroup({
                    name: groupName.trim(),
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE,
                    dailyMinimum: DEFAULT_DAILY_MINIMUM,
                    displayName: (name || me.user.firstName).trim(),
                  }),
                )
              }
            >
              Создать группу
            </Button>
            <Button variant="quiet" onClick={() => setMode('choose')}>Назад</Button>
          </div>
        )}
        {mode === 'code' && (
          <div className="stack">
            <Field label="Код приглашения" hint="Код есть в ссылке, которую прислал организатор группы.">
              <input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="none" />
            </Field>
            <Button
              disabled={!code.trim()}
              onClick={() => onEnterCode(code.trim())}
            >
              Продолжить
            </Button>
            <Button variant="quiet" onClick={() => setMode('choose')}>Назад</Button>
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </main>
    </div>
  );
}
