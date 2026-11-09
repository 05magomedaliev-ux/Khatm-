-- Роль приложения и Row Level Security.
-- Сервер подключается к базе и для каждого запроса пользователя делает
--   SET LOCAL ROLE khatm_app; set_config('app.user_id', <uuid>, true);
-- поэтому даже ошибка в коде маршрута не откроет данные чужой группы.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'khatm_app') then
    create role khatm_app nologin noinherit;
  end if;
end $$;

grant khatm_app to current_user;
grant usage on schema public, app to khatm_app;

create function app.current_user_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create function app.is_member(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = app.current_user_id() and m.status = 'active'
  )
$$;

create function app.is_admin(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = app.current_user_id()
      and m.status = 'active' and m.role in ('owner', 'admin')
  )
$$;

create function app.owns_member(mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m
    where m.id = mid and m.user_id = app.current_user_id() and m.status = 'active'
  )
$$;

create function app.shares_group(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = app.current_user_id() and mine.status = 'active' and theirs.user_id = uid
  )
$$;

create function app.can_write_member(gid uuid, mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_admin(gid) or (app.owns_member(mid) and app.is_member(gid))
$$;

-- Журнал изменений пишется триггером, поэтому его нельзя обойти из приложения.
create function app.log_report_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  action_name text;
  snapshot_before jsonb;
  snapshot_after jsonb := jsonb_build_object(
    'kind', new.kind, 'pages', new.pages, 'startPage', new.start_page,
    'endPage', new.end_page, 'readOn', new.read_on, 'note', new.note
  );
begin
  if tg_op = 'INSERT' then
    action_name := 'created';
  else
    snapshot_before := jsonb_build_object(
      'kind', old.kind, 'pages', old.pages, 'startPage', old.start_page,
      'endPage', old.end_page, 'readOn', old.read_on, 'note', old.note
    );
    if new.deleted_at is not null and old.deleted_at is null then
      action_name := 'deleted';
    elsif snapshot_before is distinct from snapshot_after then
      action_name := 'updated';
    else
      return new;
    end if;
  end if;

  insert into public.report_events (report_id, group_id, action, actor_user_id, before, after)
  values (new.id, new.group_id, action_name, app.current_user_id(), snapshot_before, snapshot_after);
  return new;
end $$;

create trigger reports_audit after insert or update on public.reports
  for each row execute function app.log_report_event();

alter table public.users            enable row level security;
alter table public.groups           enable row level security;
alter table public.group_norms      enable row level security;
alter table public.group_members    enable row level security;
alter table public.member_settings  enable row level security;
alter table public.invites          enable row level security;
alter table public.reports          enable row level security;
alter table public.report_events    enable row level security;
alter table public.achievements     enable row level security;
alter table public.notification_log enable row level security;

grant select, update on public.users to khatm_app;
grant select, update on public.groups to khatm_app;
grant select, insert, update on public.group_norms to khatm_app;
grant select, update on public.group_members to khatm_app;
grant insert on public.group_members to khatm_app;
grant select, insert, update on public.member_settings to khatm_app;
grant select, insert, update on public.invites to khatm_app;
grant select, insert, update on public.reports to khatm_app;
grant select on public.report_events to khatm_app;
grant select, insert, update on public.achievements to khatm_app;
-- notification_log: только системные задачи сервера, у роли приложения прав нет.

create policy users_read on public.users for select to khatm_app
  using (id = app.current_user_id() or app.shares_group(id));
create policy users_update on public.users for update to khatm_app
  using (id = app.current_user_id()) with check (id = app.current_user_id());

create policy groups_read on public.groups for select to khatm_app using (app.is_member(id));
create policy groups_update on public.groups for update to khatm_app
  using (app.is_admin(id)) with check (app.is_admin(id));

create policy norms_read on public.group_norms for select to khatm_app using (app.is_member(group_id));
create policy norms_insert on public.group_norms for insert to khatm_app with check (app.is_admin(group_id));
create policy norms_update on public.group_norms for update to khatm_app
  using (app.is_admin(group_id)) with check (app.is_admin(group_id));

create policy members_read on public.group_members for select to khatm_app
  using (app.is_member(group_id) or user_id = app.current_user_id());
create policy members_insert on public.group_members for insert to khatm_app
  with check (app.is_admin(group_id));
create policy members_update on public.group_members for update to khatm_app
  using (app.is_admin(group_id)) with check (app.is_admin(group_id));

create policy settings_read on public.member_settings for select to khatm_app using (app.owns_member(member_id));
create policy settings_insert on public.member_settings for insert to khatm_app with check (app.owns_member(member_id));
create policy settings_update on public.member_settings for update to khatm_app
  using (app.owns_member(member_id)) with check (app.owns_member(member_id));

create policy invites_all on public.invites for all to khatm_app
  using (app.is_admin(group_id)) with check (app.is_admin(group_id));

create policy reports_read on public.reports for select to khatm_app using (app.is_member(group_id));
create policy reports_insert on public.reports for insert to khatm_app
  with check (app.is_member(group_id) and app.can_write_member(group_id, member_id));
create policy reports_update on public.reports for update to khatm_app
  using (app.can_write_member(group_id, member_id))
  with check (app.can_write_member(group_id, member_id));

create policy events_read on public.report_events for select to khatm_app using (app.is_member(group_id));

create policy achievements_read on public.achievements for select to khatm_app using (app.is_member(group_id));
create policy achievements_insert on public.achievements for insert to khatm_app
  with check (app.can_write_member(group_id, member_id));
create policy achievements_update on public.achievements for update to khatm_app
  using (app.can_write_member(group_id, member_id))
  with check (app.can_write_member(group_id, member_id));

-- В Supabase таблицы public доступны через REST с публичным ключом:
-- снимаем права, чтобы единственным путём к данным оставался наш сервер.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all routines in schema public from %I', r);
      execute format('revoke all on schema app from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
    end if;
  end loop;
end $$;
