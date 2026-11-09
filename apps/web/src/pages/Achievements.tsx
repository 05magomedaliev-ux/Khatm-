import { Share2 } from 'lucide-react';
import { useState } from 'react';
import { renderCard } from '../components/card';
import { Button, CoverTitle, ErrorState, Loading, Screen, Section } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useApp } from '../lib/store';
import { haptic } from '../lib/telegram';
import { useApi } from '../lib/useApi';

function Medal({ earned }: { earned: boolean }) {
  return (
    <svg viewBox="-24 -24 48 48" width="52" height="52" aria-hidden="true" className={earned ? 'medal earned' : 'medal'}>
      <g>
        <rect x="-15" y="-15" width="30" height="30" />
        <rect x="-15" y="-15" width="30" height="30" transform="rotate(45)" />
      </g>
    </svg>
  );
}

export function AchievementsPage() {
  const { groupId, membership, toast, version } = useApp();
  const { data, error, loading, reload } = useApi(() => api.profile(groupId, membership.memberId), [groupId, membership.memberId, version]);
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState<'make' | 'send' | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);

  async function makeCard() {
    if (!data) return;
    setBusy('make');
    setCardError(null);
    try {
      const canvas = await renderCard(data, membership.groupName);
      setImage(canvas.toDataURL('image/jpeg', 0.92));
    } catch {
      setCardError('Не удалось нарисовать карточку на этом устройстве.');
    } finally {
      setBusy(null);
    }
  }

  async function sendCard() {
    if (!image) return;
    setBusy('send');
    setCardError(null);
    try {
      await api.sendCard(groupId, image.split(',')[1]);
      haptic.success();
      toast('Карточка отправлена в чат с ботом');
    } catch (e) {
      setCardError(e instanceof ApiError ? e.message : 'Не удалось отправить карточку.');
    } finally {
      setBusy(null);
    }
  }

  const earnedCount = data?.achievements.filter((a) => a.earnedAt).length ?? 0;

  return (
    <Screen nav={false} cover={<CoverTitle title="Достижения" subtitle={data ? `Получено ${earnedCount} из ${data.achievements.length}` : undefined} />}>
      {loading && !data && <Loading />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && (
        <>
          <div className="medals">
            {data.achievements.map((a) => (
              <div key={a.code} className={a.earnedAt ? 'medal-card' : 'medal-card locked'}>
                <Medal earned={!!a.earnedAt} />
                <strong>{a.title}</strong>
                <small>{a.earnedAt ? formatDateTime(a.earnedAt) : `${a.progress} из ${a.target}`}</small>
              </div>
            ))}
          </div>

          <Section title="Моя карточка">
            <p className="muted section-hint">Карточка собирается из ваших настоящих показателей. Её можно переслать группе.</p>
            {image && <img className="card-preview" src={image} alt="Предпросмотр персональной карточки" />}
            {cardError && <p className="form-error" role="alert">{cardError}</p>}
            <div className="stack">
              <Button variant={image ? 'quiet' : 'primary'} busy={busy === 'make'} onClick={makeCard}>
                {image ? 'Собрать заново' : 'Собрать карточку'}
              </Button>
              {image && (
                <Button busy={busy === 'send'} onClick={sendCard}>
                  <Share2 size={16} /> Отправить мне в Telegram
                </Button>
              )}
            </div>
          </Section>
        </>
      )}
    </Screen>
  );
}
