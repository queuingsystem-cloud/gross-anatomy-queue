alter table public.lab_sessions
  add column if not exists quota_bonus integer not null default 0
  check (quota_bonus >= 0);

alter table public.lab_tables
  add column if not exists cooldown_reset_at timestamptz;

alter table public.help_requests
  add column if not exists quota_charged boolean not null default true,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id),
  add column if not exists cancelled_actor text
    check (cancelled_actor in ('student', 'admin'));

-- Earlier prototypes may have restricted status to waiting/completed only.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.help_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) ilike '%waiting%'
  loop
    execute format('alter table public.help_requests drop constraint %I', constraint_name);
  end loop;
end;
$$;

alter table public.help_requests
  add constraint help_requests_status_check
  check (status in ('waiting', 'completed', 'cancelled'));

create index if not exists idx_help_requests_charged_history
  on public.help_requests (session_id, table_id, created_at desc)
  where quota_charged = true;

create or replace function public.add_session_quota(
  p_session_id uuid,
  p_amount integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_total integer;
begin
  if p_amount < 1 or p_amount > 20 then
    raise exception 'invalid_quota_amount';
  end if;

  update public.lab_sessions
  set quota_bonus = quota_bonus + p_amount
  where id = p_session_id
    and status = 'open'
  returning request_limit + quota_bonus into new_total;

  if new_total is null then
    raise exception 'open_session_not_found';
  end if;
  return new_total;
end;
$$;

revoke all on function public.add_session_quota(uuid, integer) from public, anon, authenticated;
grant execute on function public.add_session_quota(uuid, integer) to service_role;

create or replace function public.rotate_lab_table_pin(
  p_table_id uuid,
  p_pin text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.lab_tables
  set pin_hash = crypt(p_pin, gen_salt('bf'))
  where id = p_table_id;
  return found;
end;
$$;

revoke all on function public.rotate_lab_table_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.rotate_lab_table_pin(uuid, text) to service_role;
