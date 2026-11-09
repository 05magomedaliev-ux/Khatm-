-- Первая группа: пять участников без единого результата.
-- Участники подключаются сами: открывают приглашение и выбирают своё имя.
-- Скрипт можно запускать повторно: ничего не задублируется.

begin;

insert into public.groups (id, name, timezone)
values ('11111111-1111-4111-8111-111111111111', 'Хатм — наш путь', 'Europe/Moscow')
on conflict (id) do nothing;

insert into public.group_norms (group_id, effective_from, daily_minimum)
values ('11111111-1111-4111-8111-111111111111', '2020-01-01', 2)
on conflict do nothing;

insert into public.group_members (id, group_id, display_name)
values
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111111', 'Мурад'),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111111', 'Курбан'),
  ('22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111111', 'Закария'),
  ('22222222-2222-4222-8222-222222222204', '11111111-1111-4111-8111-111111111111', 'Мухаммад'),
  ('22222222-2222-4222-8222-222222222205', '11111111-1111-4111-8111-111111111111', 'Марат')
on conflict (id) do nothing;

insert into public.member_settings (member_id)
select id from public.group_members where group_id = '11111111-1111-4111-8111-111111111111'
on conflict do nothing;

insert into public.invites (group_id, code)
select '11111111-1111-4111-8111-111111111111', replace(gen_random_uuid()::text, '-', '')
where not exists (
  select 1 from public.invites
  where group_id = '11111111-1111-4111-8111-111111111111' and revoked_at is null
);

commit;

-- Код для первой ссылки-приглашения: https://t.me/<ИМЯ_БОТА>?start=<код>
select code as invite_code from public.invites
where group_id = '11111111-1111-4111-8111-111111111111' and revoked_at is null
order by created_at limit 1;
