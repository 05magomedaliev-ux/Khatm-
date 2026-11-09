-- Чат с темами: публикации идут в выбранную тему, потому что общая тема может быть закрыта.
alter table public.groups add column telegram_thread_id integer;
