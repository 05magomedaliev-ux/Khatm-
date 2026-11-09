import type { CalendarDay } from '@khatm/shared';
import { weekdayIndex } from '@khatm/shared';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function MonthCalendar({
  days,
  today,
  onSelect,
}: {
  days: CalendarDay[];
  today: string;
  onSelect(date: string): void;
}) {
  const lead = days.length ? weekdayIndex(days[0].date) : 0;
  return (
    <div className="month">
      {WEEKDAYS.map((w) => (
        <div className="month-head" key={w}>{w}</div>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <div key={`gap-${i}`} />
      ))}
      {days.map((day) => (
        <button
          type="button"
          key={day.date}
          className={`day day-${day.status}${day.date === today ? ' day-today' : ''}`}
          aria-label={`${Number(day.date.slice(8))}, прочитано ${day.pages} стр.`}
          onClick={() => onSelect(day.date)}
        >
          <span className="day-num">{Number(day.date.slice(8))}</span>
          {day.pages > 0 && <span className="day-pages">{day.pages}</span>}
        </button>
      ))}
    </div>
  );
}

export function CalendarLegend() {
  return (
    <ul className="legend">
      <li><i className="dot dot-met" />Норма выполнена</li>
      <li><i className="dot dot-partial" />Прочитано, но меньше нормы</li>
      <li><i className="dot dot-missed" />День без чтения</li>
      <li><i className="dot dot-none" />Нет данных</li>
    </ul>
  );
}
