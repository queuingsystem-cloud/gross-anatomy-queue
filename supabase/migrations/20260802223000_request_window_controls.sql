-- Opening a lab session lets students claim tables, but requests remain paused
-- until an administrator opens them immediately or schedules a countdown.
create or replace function public.open_lab_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lab_sessions
  set status = 'closed'
  where status = 'open'
    and id <> p_session_id;

  update public.lab_sessions
  set status = 'open',
      requests_open_at = null,
      requests_close_at = now()
  where id = p_session_id;

  if not found then
    raise exception 'session_not_found';
  end if;
end;
$$;

revoke all on function public.open_lab_session(uuid) from public, anon, authenticated;
grant execute on function public.open_lab_session(uuid) to service_role;
