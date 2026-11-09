import { CalendarDays, House, Plus, Trophy, Users } from 'lucide-react';
import { haptic } from '../lib/telegram';
import { useApp, type Route } from '../lib/store';

const ITEMS: { route: Route; label: string; Icon: typeof House }[] = [
  { route: { name: 'home' }, label: 'Главная', Icon: House },
  { route: { name: 'group' }, label: 'Группа', Icon: Users },
  { route: { name: 'calendar' }, label: 'Календарь', Icon: CalendarDays },
  { route: { name: 'rating' }, label: 'Рейтинг', Icon: Trophy },
];

export function BottomNav() {
  const { route, navigate } = useApp();
  const link = (item: (typeof ITEMS)[number]) => (
    <button
      key={item.label}
      type="button"
      className={`nav-item${route.name === item.route.name ? ' active' : ''}`}
      aria-current={route.name === item.route.name ? 'page' : undefined}
      onClick={() => {
        haptic.tap();
        navigate(item.route);
      }}
    >
      <item.Icon size={22} strokeWidth={1.6} />
      <span>{item.label}</span>
    </button>
  );
  return (
    <nav className="bottom-nav" aria-label="Разделы">
      {ITEMS.slice(0, 2).map(link)}
      <button
        type="button"
        className="nav-add"
        aria-label="Внести результат"
        onClick={() => {
          haptic.tap();
          navigate({ name: 'add' });
        }}
      >
        <span className="nav-star">
          <Plus size={26} strokeWidth={2} />
        </span>
      </button>
      {ITEMS.slice(2).map(link)}
    </nav>
  );
}
