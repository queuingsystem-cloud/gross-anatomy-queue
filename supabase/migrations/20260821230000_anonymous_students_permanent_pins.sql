-- Students identify their table with a permanent PIN instead of a Google login.
-- PINs are only readable through the service-role Edge Function; direct client
-- access remains blocked by RLS.
create table if not exists public.permanent_table_pins (
  table_label text primary key check (char_length(trim(table_label)) between 1 and 30),
  pin_code text not null check (pin_code ~ '^[0-9]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.permanent_table_pins enable row level security;

insert into public.permanent_table_pins (table_label, pin_code)
select number::text, (100000 + floor(random() * 900000))::integer::text
from generate_series(1, 39) as number
on conflict (table_label) do nothing;

create or replace function public.get_or_create_permanent_table_pin(p_label text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_label text := trim(p_label);
  result_pin text;
begin
  if char_length(normalized_label) < 1 or char_length(normalized_label) > 30 then
    raise exception 'invalid_table_label';
  end if;

  insert into public.permanent_table_pins (table_label, pin_code)
  values (normalized_label, (100000 + floor(random() * 900000))::integer::text)
  on conflict (table_label) do nothing;

  select pin_code into result_pin
  from public.permanent_table_pins
  where table_label = normalized_label;

  return result_pin;
end;
$$;

revoke all on function public.get_or_create_permanent_table_pin(text) from public, anon, authenticated;
grant execute on function public.get_or_create_permanent_table_pin(text) to service_role;

-- Reuse the permanent PIN for existing sessions as well as future sessions.
update public.lab_tables as table_row
set pin_hash = extensions.crypt(pin.pin_code, extensions.gen_salt('bf'))
from public.permanent_table_pins as pin
where pin.table_label = table_row.label;

alter table public.student_table_assignments
  alter column user_id drop not null;

alter table public.student_table_assignments
  add column if not exists claim_token_hash text;

alter table public.student_table_assignments
  drop constraint if exists student_table_assignments_claim_identity_check;

alter table public.student_table_assignments
  add constraint student_table_assignments_claim_identity_check
  check (user_id is not null or claim_token_hash is not null);

create unique index if not exists student_table_assignments_session_token_idx
  on public.student_table_assignments (session_id, claim_token_hash)
  where claim_token_hash is not null;

create or replace function public.claim_lab_table_anonymous(
  p_session_id uuid,
  p_table_id uuid,
  p_claim_token_hash text,
  p_pin text
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  existing_assignment public.student_table_assignments%rowtype;
begin
  if p_claim_token_hash !~ '^[0-9a-f]{64}$' then
    return 'invalid_claim_token';
  end if;

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

  select * into existing_assignment
  from public.student_table_assignments
  where session_id = p_session_id and table_id = p_table_id
  for update;

  if existing_assignment.id is not null then
    if existing_assignment.claim_token_hash = p_claim_token_hash then
      return 'ok';
    end if;

    -- Convert a legacy email-based claim when its holder presents the correct
    -- permanent table PIN for the first time after this migration.
    if existing_assignment.claim_token_hash is null then
      update public.student_table_assignments
      set user_id = null,
          claim_token_hash = p_claim_token_hash,
          claimed_at = now()
      where id = existing_assignment.id;
      return 'ok';
    end if;

    return 'table_already_claimed';
  end if;

  insert into public.student_table_assignments (
    session_id,
    table_id,
    user_id,
    claim_token_hash
  ) values (
    p_session_id,
    p_table_id,
    null,
    p_claim_token_hash
  );

  return 'ok';
end;
$$;

revoke all on function public.claim_lab_table_anonymous(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_lab_table_anonymous(uuid, uuid, text, text) to service_role;

-- Email-based administrator access can be managed in Supabase or through the
-- app's Admin Access panel. Existing user-id app_admins remain valid.
create table if not exists public.admin_email_allowlist (
  email text primary key check (email = lower(trim(email)) and position('@' in email) > 1),
  role text not null default 'admin' check (role in ('admin', 'instructor')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.admin_email_allowlist enable row level security;

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
  ) or exists (
    select 1
    from public.admin_email_allowlist
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and active = true
  );
$$;

revoke all on function public.is_active_app_admin() from public, anon;
grant execute on function public.is_active_app_admin() to authenticated;

-- Anonymous students need only the non-sensitive event signal for realtime
-- refreshes. app_events never contains PINs, email addresses, or problem text.
grant select on public.app_events to anon;

drop policy if exists "anonymous clients can receive app events" on public.app_events;
create policy "anonymous clients can receive app events"
on public.app_events
for select
to anon
using (true);
