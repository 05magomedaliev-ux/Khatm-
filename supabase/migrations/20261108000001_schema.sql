-- Хатм — наш путь: основная схема.
-- Задолженность, рейтинги и статусы дней здесь не хранятся: они всегда считаются
-- из отчётов, поэтому правка задним числом не может оставить данные рассогласованными.

create schema if not exists app;

create table public.users (
  id              uuid primary key default gen_random_uuid(),
  telegram_id     bigint not null unique,
  first_name      text not null,
  last_name       text,
  username        text,
  photo_url       text,
  language_code   text,
  bot_blocked     boolean not null default false,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

create table public.groups (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(name) between 1 and 60),
  timezone           text not null default 'Europe/Moscow',
  reminder_time      time not null default '20:00',
  report_time        time not null default '22:30',
  reminders_enabled  boolean not null default true,
  reports_enabled    boolean not null default true,
  telegram_chat_id   bigint unique,
  telegram_chat_title text,
  link_code          text unique,
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now()
);

-- История нормы: смена нормы не должна менять уже прошедшие дни.
create table public.group_norms (
  group_id        uuid not null references public.groups(id) on delete cascade,
  effective_from  date not null,
  daily_minimum   integer not null check (daily_minimum between 1 and 604),
  created_at      timestamptz not null default now(),
  primary key (group_id, effective_from)
);

create table public.group_members (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  -- NULL: участник заведён заранее и ещё не подключил свой Telegram.
  user_id       uuid references public.users(id) on delete set null,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  role          text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status        text not null default 'active' check (status in ('active', 'blocked', 'removed')),
  -- С этой даты идёт учёт. NULL: учёт ещё не начат.
  started_on    date,
  joined_at     timestamptz,
  created_at    timestamptz not null default now(),
  unique (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);
create index group_members_group_idx on public.group_members (group_id) where status = 'active';
create unique index group_members_one_owner on public.group_members (group_id) where role = 'owner' and status = 'active';

create table public.member_settings (
  member_id             uuid primary key references public.group_members(id) on delete cascade,
  reminders_enabled     boolean not null default true,
  -- NULL: используется время напоминания группы.
  reminder_time         time,
  daily_report_enabled  boolean not null default true,
  achievements_enabled  boolean not null default true
);

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  code        text not null unique,
  created_by  uuid references public.users(id) on delete set null,
  max_uses    integer check (max_uses > 0),
  used_count  integer not null default 0,
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index invites_group_idx on public.invites (group_id) where revoked_at is null;

create table public.reports (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references public.groups(id) on delete cascade,
  member_id          uuid not null references public.group_members(id) on delete cascade,
  -- count: агрегированный отчёт без номеров страниц, пересечения не проверяются;
  -- range: точный отчёт с номерами страниц.
  kind               text not null check (kind in ('count', 'range')),
  pages              integer not null check (pages between 1 and 604),
  start_page         integer,
  end_page           integer,
  read_on            date not null,
  note               text check (char_length(note) <= 200),
  repeat_confirmed   boolean not null default false,
  client_request_id  uuid not null,
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  -- Защита от двойной отправки на уровне базы.
  unique (member_id, client_request_id),
  constraint reports_shape check (
    (kind = 'count' and start_page is null and end_page is null)
    or (
      kind = 'range' and start_page is not null and end_page is not null
      and start_page between 1 and 604 and end_page between 1 and 604
      and start_page <= end_page and pages = end_page - start_page + 1
    )
  )
);
create index reports_group_recent_idx on public.reports (group_id, created_at desc) where deleted_at is null;
create index reports_member_day_idx on public.reports (member_id, read_on) where deleted_at is null;
create index reports_group_day_idx on public.reports (group_id, read_on) where deleted_at is null;

-- Полная история изменений отчётов. Заполняется только триггером.
create table public.report_events (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references public.reports(id) on delete cascade,
  group_id       uuid not null references public.groups(id) on delete cascade,
  action         text not null check (action in ('created', 'updated', 'deleted')),
  actor_user_id  uuid references public.users(id) on delete set null,
  before         jsonb,
  after          jsonb,
  created_at     timestamptz not null default now()
);
create index report_events_report_idx on public.report_events (report_id, created_at);

create table public.achievements (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  member_id    uuid not null references public.group_members(id) on delete cascade,
  code         text not null,
  earned_at    timestamptz not null default now(),
  -- Правка отчётов может отменить достижение; при повторном получении уведомления не дублируются.
  revoked_at   timestamptz,
  notified_at  timestamptz,
  unique (member_id, code)
);
create index achievements_outbox_idx on public.achievements (earned_at) where notified_at is null and revoked_at is null;

-- Журнал рассылок: уникальный индекс не даёт отправить одно уведомление дважды,
-- в том числе при нескольких запущенных экземплярах сервера.
create table public.notification_log (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('reminder', 'daily_report')),
  group_id    uuid not null references public.groups(id) on delete cascade,
  member_id   uuid references public.group_members(id) on delete cascade,
  local_date  date not null,
  sent_at     timestamptz not null default now()
);
create unique index notification_log_once on public.notification_log
  (kind, group_id, coalesce(member_id, '00000000-0000-0000-0000-000000000000'::uuid), local_date);

-- updated_at
create function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger reports_touch before update on public.reports
  for each row execute function app.touch_updated_at();
