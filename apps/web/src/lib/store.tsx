import type { MeResponse, MembershipView, ReportView } from '@khatm/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { webApp } from './telegram';

export type Route =
  | { name: 'home' }
  | { name: 'group' }
  | { name: 'add'; report?: ReportView }
  | { name: 'calendar'; memberId?: string }
  | { name: 'rating' }
  | { name: 'profile'; memberId?: string }
  | { name: 'achievements' }
  | { name: 'settings' }
  | { name: 'admin' };

interface AppState {
  me: MeResponse;
  membership: MembershipView;
  groupId: string;
  route: Route;
  canGoBack: boolean;
  navigate(route: Route): void;
  replace(route: Route): void;
  back(): void;
  selectGroup(groupId: string): void;
  reloadMe(): Promise<void>;
  /** Меняется после любой записи: экраны перечитывают данные. */
  version: number;
  bump(): void;
  toast(message: string): void;
  toastMessage: string | null;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useApp вне AppProvider');
  return value;
}

const GROUP_KEY = 'khatm.groupId';

function readStoredGroup(): string | null {
  try {
    return localStorage.getItem(GROUP_KEY);
  } catch {
    return null;
  }
}

function storeGroup(groupId: string): void {
  try {
    localStorage.setItem(GROUP_KEY, groupId);
  } catch {
    /* хранилище недоступно: группа выбирается заново при запуске */
  }
}

export function AppProvider({
  me,
  reloadMe,
  children,
}: {
  me: MeResponse;
  reloadMe(): Promise<void>;
  children: ReactNode;
}) {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const [groupId, setGroupId] = useState<string>(() => {
    const stored = readStoredGroup();
    return me.memberships.some((m) => m.groupId === stored) ? stored! : me.memberships[0].groupId;
  });
  const [version, setVersion] = useState(0);
  const [toastMessage, setToast] = useState<string | null>(null);

  const membership = me.memberships.find((m) => m.groupId === groupId) ?? me.memberships[0];

  useEffect(() => {
    if (membership.groupId !== groupId) setGroupId(membership.groupId);
  }, [membership.groupId, groupId]);

  const navigate = useCallback((route: Route) => {
    window.scrollTo(0, 0);
    setStack((s) => {
      // Разделы нижней панели не накапливаются: нажатие возвращает к корню.
      if (['home', 'group', 'calendar', 'rating'].includes(route.name)) {
        return route.name === 'home' ? [route] : [{ name: 'home' }, route];
      }
      return [...s, route];
    });
  }, []);

  const replace = useCallback((route: Route) => {
    window.scrollTo(0, 0);
    setStack((s) => [...s.slice(0, -1), route]);
  }, []);

  const back = useCallback(() => {
    window.scrollTo(0, 0);
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const canGoBack = stack.length > 1;

  useEffect(() => {
    const app = webApp();
    if (!app || !app.isVersionAtLeast('6.1')) return;
    if (canGoBack) {
      app.BackButton.show();
      app.BackButton.onClick(back);
      return () => {
        app.BackButton.offClick(back);
        app.BackButton.hide();
      };
    }
    app.BackButton.hide();
  }, [canGoBack, back]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const value = useMemo<AppState>(
    () => ({
      me,
      membership,
      groupId: membership.groupId,
      route: stack[stack.length - 1],
      canGoBack,
      navigate,
      replace,
      back,
      selectGroup(id) {
        storeGroup(id);
        setGroupId(id);
        setStack([{ name: 'home' }]);
      },
      reloadMe,
      version,
      bump: () => setVersion((v) => v + 1),
      toast: setToast,
      toastMessage,
    }),
    [me, membership, stack, canGoBack, navigate, replace, back, reloadMe, version, toastMessage],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
