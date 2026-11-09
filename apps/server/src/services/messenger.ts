/** То, что сервису уведомлений нужно от бота. В тестах подменяется записью вызовов. */
export interface MessageButton {
  text: string;
  /** Кнопка Mini App: работает только в личных чатах. */
  webAppUrl?: string;
  url?: string;
}

export interface Messenger {
  send(chatId: number, html: string, button?: MessageButton): Promise<void>;
  sendPhoto(chatId: number, image: Buffer, caption: string): Promise<void>;
}

/** Пользователь не запускал бота или заблокировал его. */
export class RecipientUnavailable extends Error {}

export class NullMessenger implements Messenger {
  async send(): Promise<void> {}
  async sendPhoto(): Promise<void> {}
}
