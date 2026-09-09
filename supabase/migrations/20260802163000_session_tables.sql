create extension if not exists pgcrypto with schema extensions;

create table if not exists public.lab_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  starts_at timestamptz,
  ends_at timestamptz,
  requests_open_at timestamptz,
  requests_close_at timestamptz,
  request_limit integer not null default 5 check (request_limit > 0),
  cooldown_seconds integer not null default 0 check (cooldown_seconds >= 0),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_one_open_lab_session
  on public.lab_sessions (status)
  where status = 'open';

create table if not exists public.lab_tables (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.lab_sessions(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 30),
  zone text,
  sort_order integer not null default 0,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  unique (session_id, label)
);

create index if not exists idx_lab_tables_session_order
  on public.lab_tables (session_id, sort_order, label);

create table if not exists public.student_table_assignments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.lab_sessions(id) on delete cascade,
  table_id uuid not null references public.lab_tables(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  unique (session_id, user_id),
  unique (session_id, table_id)
);

alter table public.help_requests
  add column if not exists session_id uuid references public.lab_sessions(id),
  add column if not exists table_id uuid references public.lab_tables(id),
  add column if not exists requested_by uuid references auth.users(id);

alter table public.help_requests alter column group_number drop not null;
alter table public.help_requests alter column zone drop not null;

drop index if exists public.idx_one_waiting_per_group;

create unique index if not exists idx_one_waiting_per_session_table
  on public.help_requests (session_id, table_id)
  where status = 'waiting' and session_id is not null and table_id is not null;

create index if not exists idx_help_requests_session_history
  on public.help_requests (session_id, table_id, created_at desc);

alter table public.lab_sessions enable row level security;
alter table public.lab_tables enable row level security;
alter table public.student_table_assignments enable row level security;

create or replace function public.claim_lab_table(
  p_session_id uuid,
  p_table_id uuid,
  p_user_id uuid,
  p_pin text
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  existing_user_table uuid;
  existing_table_user uuid;
begin
  if not exists (
    select 1 from public.lab_sessions
    where id = p_session_id and status = 'open'
  ) then
    return 'session_not_open';
  end if;

  if not exists (
    select 1 from public.lab_tables
    where id = p_table_id
      and session_id = p_session_id
      and pin_hash = crypt(p_pin, pin_hash)
  ) then
    return 'invalid_table_or_pin';
  end if;

  select table_id into existing_user_table
  from public.student_table_assignments
  where session_id = p_session_id and user_id = p_user_id;

  if existing_user_table is not null then
    if existing_user_table = p_table_id then return 'ok'; end if;
    return 'user_already_assigned';
  end if;

  select user_id into existing_table_user
  from public.student_table_assignments
  where session_id = p_session_id and table_id = p_table_id;

  if existing_table_user is not null then
    return 'table_already_claimed';
  end if;

  insert into public.student_table_assignments (session_id, table_id, user_id)
  values (p_session_id, p_table_id, p_user_id);

  return 'ok';
end;
$$;

revoke all on function public.claim_lab_table(uuid, uuid, uuid, text) from public;
revoke all on function public.claim_lab_table(uuid, uuid, uuid, text) from anon;
revoke all on function public.claim_lab_table(uuid, uuid, uuid, text) from authenticated;
grant execute on function public.claim_lab_table(uuid, uuid, uuid, text) to service_role;

-- Example setup after the real table list is known:
-- insert into public.lab_sessions (title, status) values ('Gross Lab - Demo', 'open');
-- insert into public.lab_tables (session_id, label, zone, sort_order, pin_hash)
-- select id, 'Table 1', null, 1, crypt('1234', gen_salt('bf'))
-- from public.lab_sessions where status = 'open';
