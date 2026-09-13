alter table public.lab_sessions
  drop constraint if exists lab_sessions_queue_priority_display_check;

alter table public.lab_sessions
  add constraint lab_sessions_queue_priority_display_check
  check (queue_priority_display in ('gradient', 'number', 'off'));
