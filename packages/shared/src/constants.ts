/** Полный Коран в стандартном мединском мусхафе. */
export const QURAN_PAGES = 604;
export const JUZ_COUNT = 30;
export const DEFAULT_DAILY_MINIMUM = 2;
export const MAX_DAILY_MINIMUM = 604;
export const DEFAULT_TIMEZONE = 'Europe/Moscow';

/** Показатель серии S в рейтинге дисциплины ограничен этим числом дней. */
export const STREAK_RATING_CAP_DAYS = 30;
/** Долг, равный этому числу дневных норм, обнуляет показатель B. */
export const DEBT_RATING_CAP_NORMS = 30;
/** Прогноз завершения считается, только когда накоплено столько дней учёта. */
export const FORECAST_MIN_DAYS = 3;
/** Окно темпа для прогноза. */
export const FORECAST_WINDOW_DAYS = 30;
/** Одинаковый отчёт-количество за ту же дату в этом окне считается возможным дублем. */
export const DUPLICATE_WINDOW_MINUTES = 10;
/** Через сколько дней после погашения участник ещё показывается как «закрыл долг». */
export const DEBT_CLEARED_VISIBLE_DAYS = 7;
