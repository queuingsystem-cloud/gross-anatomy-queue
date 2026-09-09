alter table public.lab_sessions
  add column if not exists archived_at timestamptz;

alter table public.help_requests
  add column if not exists problem_category text not null default 'other',
  add column if not exists instructor_arrived_at timestamptz;

alter table public.help_requests
  drop constraint if exists help_requests_problem_category_check;

alter table public.help_requests
  add constraint help_requests_problem_category_check
  check (problem_category in (
    'identify_structure',
    'dissection_technique',
    'anatomical_relationship',
    'clarify_instructions',
    'specimen_issue',
    'other'
  ));

alter table public.help_requests
  drop constraint if exists help_requests_status_check;

alter table public.help_requests
  add constraint help_requests_status_check
  check (status in ('waiting', 'arrived', 'completed', 'cancelled'));

create index if not exists idx_lab_sessions_archive
  on public.lab_sessions (archived_at, created_at desc);

create index if not exists idx_help_requests_report
  on public.help_requests (session_id, status, problem_category, created_at);

create or replace function public.open_lab_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.lab_sessions
    where id = p_session_id and archived_at is null
  ) then
    raise exception 'active_session_not_found';
  end if;

  if exists (
    select 1 from public.lab_sessions
    where status = 'open' and id <> p_session_id
  ) then
    raise exception 'close_current_session_first';
  end if;

  update public.lab_sessions
  set status = 'open',
      requests_open_at = null,
      requests_close_at = now()
  where id = p_session_id
    and archived_at is null;
end;
$$;

revoke all on function public.open_lab_session(uuid) from public, anon, authenticated;
grant execute on function public.open_lab_session(uuid) to service_role;

-- Ends a session as one transaction. Any requests still waiting are treated as
-- administrative cancellations so they do not remain stuck in an old queue.
create or replace function public.end_lab_session(
  p_session_id uuid,
  p_admin_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ended boolean;
  ended_at timestamptz := now();
begin
  update public.help_requests
  set status = 'cancelled',
      quota_charged = false,
      cancelled_at = ended_at,
      cancelled_by = p_admin_id,
      cancelled_actor = 'admin'
  where session_id = p_session_id
    and status = 'waiting';

  update public.lab_sessions
  set status = 'closed',
      requests_open_at = null,
      requests_close_at = ended_at
  where id = p_session_id
    and status in ('draft', 'open');

  ended := found;
  return ended;
end;
$$;

revoke all on function public.end_lab_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.end_lab_session(uuid, uuid) to service_role;

-- Permanent deletion is deliberately restricted to sessions that are both
-- closed and archived. Requests are removed first because older prototypes did
-- not give their session foreign key an ON DELETE CASCADE action.
create or replace function public.delete_archived_lab_session(
  p_session_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.lab_sessions
    where id = p_session_id
      and status = 'closed'
      and archived_at is not null
  ) then
    return false;
  end if;

  delete from public.help_requests where session_id = p_session_id;
  delete from public.lab_sessions where id = p_session_id;
  return found;
end;
$$;

revoke all on function public.delete_archived_lab_session(uuid) from public, anon, authenticated;
grant execute on function public.delete_archived_lab_session(uuid) to service_role;
