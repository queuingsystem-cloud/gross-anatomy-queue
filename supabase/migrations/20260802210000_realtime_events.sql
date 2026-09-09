-- A minimal event stream for the student and display interfaces.
-- Event rows contain no problem text, PIN, email, or user identifier.
create table if not exists public.app_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('queue', 'session')),
  session_id uuid references public.lab_sessions(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists app_events_created_at_idx
  on public.app_events (created_at desc);

alter table public.app_events enable row level security;

create or replace function public.is_active_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_admins
    where user_id = auth.uid()
      and active = true
  );
$$;

revoke all on function public.is_active_app_admin() from public, anon;
grant execute on function public.is_active_app_admin() to authenticated;

grant select on public.app_events to authenticated;

create policy "eligible users can receive app events"
on public.app_events
for select
to authenticated
using (
  split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 2) = 'student.chula.ac.th'
  or public.is_active_app_admin()
);

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
    target_session_id := coalesce(new.session_id, old.session_id);
    target_event_type := 'queue';
  else
    target_session_id := coalesce(new.id, old.id);
    target_event_type := 'session';
  end if;

  insert into public.app_events (event_type, session_id)
  values (target_event_type, target_session_id);

  return coalesce(new, old);
end;
$$;

revoke all on function public.emit_gross_queue_event() from public, anon, authenticated;

drop trigger if exists help_requests_emit_event on public.help_requests;
create trigger help_requests_emit_event
after insert or update or delete on public.help_requests
for each row execute function public.emit_gross_queue_event();

drop trigger if exists lab_sessions_emit_event on public.lab_sessions;
create trigger lab_sessions_emit_event
after insert or update or delete on public.lab_sessions
for each row execute function public.emit_gross_queue_event();

alter publication supabase_realtime add table public.app_events;
