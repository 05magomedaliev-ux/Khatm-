/** Тонкая типизированная обёртка над официальным Telegram Web Apps SDK. */
export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string };
  version: string;
  platform: string;
  ready(): void;
  expand(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  isVersionAtLeast(version: string): boolean;
  openTelegramLink(url: string): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function webApp(): TelegramWebApp | null {
  const app = window.Telegram?.WebApp;
  return app && app.initData ? app : null;
}

export function initTelegram(): void {
  const app = webApp();
  if (!app) return;
  app.ready();
  app.expand();
  if (app.isVersionAtLeast('6.1')) {
    app.setHeaderColor('#103229');
    app.setBackgroundColor('#0b251e');
  }
  if (app.isVersionAtLeast('7.10')) app.setBottomBarColor?.('#0b251e');
  if (app.isVersionAtLeast('7.7')) app.disableVerticalSwipes?.();
}

function supportsHaptics(app: TelegramWebApp): boolean {
  return app.isVersionAtLeast('6.1');
}

export const haptic = {
  tap() {
    const app = webApp();
    if (app && supportsHaptics(app)) app.HapticFeedback.selectionChanged();
  },
  success() {
    const app = webApp();
    if (app && supportsHaptics(app)) app.HapticFeedback.notificationOccurred('success');
  },
  warning() {
    const app = webApp();
    if (app && supportsHaptics(app)) app.HapticFeedback.notificationOccurred('warning');
  },
};

/** Код приглашения: из прямой ссылки startapp либо из параметра кнопки бота. */
export function inviteCodeFromLaunch(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('invite');
  if (fromUrl) return fromUrl;
  const start = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  return start || null;
}

export function shareLink(url: string, text: string): void {
  const target = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  const app = webApp();
  if (app) app.openTelegramLink(target);
  else window.open(target, '_blank');
}
