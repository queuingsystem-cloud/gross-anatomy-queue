-- Deletion events do not reference a row that has already been removed.
create or replace function public.emit_gross_queue_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_session_id uuid;
  target_event_type text;
begin
  if tg_table_name = 'help_requests' then
    target_event_type := 'queue';
    target_session_id := case when tg_op = 'DELETE' then null else new.session_id end;
  else
    target_event_type := 'session';
    target_session_id := case when tg_op = 'DELETE' then null else new.id end;
  end if;

  insert into public.app_events (event_type, session_id)
  values (target_event_type, target_session_id);

  return coalesce(new, old);
end;
$$;

revoke all on function public.emit_gross_queue_event() from public, anon, authenticated;
