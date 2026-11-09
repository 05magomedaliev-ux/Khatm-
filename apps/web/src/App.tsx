import type { MeResponse } from '@khatm/shared';
import { useCallback, useEffect, useState } from 'react';
import { ErrorState, Loading, Toast } from './components/ui';
import { api, ApiError } from './lib/api';
import { AppProvider, useApp } from './lib/store';
import { inviteCodeFromLaunch, webApp } from './lib/telegram';
import { AchievementsPage } from './pages/Achievements';
import { AddReportPage } from './pages/AddReport';
import { AdminPage } from './pages/Admin';
import { CalendarPage } from './pages/Calendar';
import { GroupPage } from './pages/Group';
import { HomePage } from './pages/Home';
import { OnboardingPage } from './pages/Onboarding';
import { ProfilePage } from './pages/Profile';
import { RatingPage } from './pages/Rating';
import { SettingsPage } from './pages/Settings';

function Router() {
  const { route } = useApp();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'group':
      return <GroupPage />;
    case 'add':
      return <AddReportPage key={route.report?.id ?? 'new'} report={route.report} />;
    case 'calendar':
      return <CalendarPage initialMemberId={route.memberId} />;
    case 'rating':
      return <RatingPage />;
    case 'profile':
      return <ProfilePage key={route.memberId ?? 'me'} memberId={route.memberId} />;
    case 'achievements':
      return <AchievementsPage />;
    case 'settings':
      return <SettingsPage />;
    case 'admin':
      return <AdminPage />;
  }
}

export function App() {
  const insideTelegram = webApp() !== null;
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [invite, setInvite] = useState<string | null>(() => inviteCodeFromLaunch());

  const loadMe = useCallback(async () => {
    setError(null);
    try {
      setMe(await api.me());
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'unknown', 'Не удалось открыть приложение.'));
    }
  }, []);

  useEffect(() => {
    if (insideTelegram) void loadMe();
  }, [insideTelegram, loadMe]);

  if (!insideTelegram) {
    return (
      <div className="splash">
        <h1>Хатм — наш путь</h1>
        <p>Приложение работает внутри Telegram. Откройте его через бота, чтобы войти под своим аккаунтом.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="splash">
        <ErrorState error={error} onRetry={loadMe} />
      </div>
    );
  }
  if (!me) {
    return (
      <div className="splash">
        <Loading />
      </div>
    );
  }
  if (me.memberships.length === 0 || invite) {
    return (
      <OnboardingPage
        me={me}
        inviteCode={invite}
        onDone={async () => {
          setInvite(null);
          await loadMe();
        }}
        onDismissInvite={() => setInvite(null)}
        onEnterCode={setInvite}
      />
    );
  }
  return (
    <AppProvider me={me} reloadMe={loadMe}>
      <Router />
      <Toast />
    </AppProvider>
  );
}
