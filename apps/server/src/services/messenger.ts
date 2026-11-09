/** То, что сервису уведомлений нужно от бота. В тестах подменяется записью вызовов. */
export interface MessageButton {
  text: string;
  /** Кнопка Mini App: работает только в личных чатах. */
  webAppUrl?: string;
  url?: string;
}

export interface Messenger {
  send(chatId: number, html: string, button?: MessageButton): Promise<void>;
  sendPhoto(chatId: number, image: Buffer, caption: string, button?: MessageButton): Promise<void>;
}

/** Пользователь не запускал бота или заблокировал его. */
export class RecipientUnavailable extends Error {}

/** Telegram сменил id чата: обычная группа стала супергруппой. */
export class ChatMigrated extends Error {
  constructor(public newChatId: number) {
    super('Чат переведён в супергруппу');
  }
}

export class NullMessenger implements Messenger {
  async send(): Promise<void> {}
  async sendPhoto(): Promise<void> {}
}
