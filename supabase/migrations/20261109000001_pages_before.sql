-- Страницы, прочитанные до начала учёта. Входят в общий итог и процент Хатма,
-- но не участвуют в расчёте долга, серий, темпа и дисциплины.

alter table public.group_members
  add column pages_before integer not null default 0 check (pages_before between 0 and 604);

-- Обычный участник не имеет права менять строку group_members (там роль и статус),
-- поэтому своё значение он задаёт только через эту функцию.
create function app.set_pages_before(gid uuid, mid uuid, pages integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.can_write_member(gid, mid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.group_members
  set pages_before = pages
  where id = mid and group_id = gid and status = 'active';
end $$;

revoke all on function app.set_pages_before(uuid, uuid, integer) from public;
grant execute on function app.set_pages_before(uuid, uuid, integer) to khatm_app;
