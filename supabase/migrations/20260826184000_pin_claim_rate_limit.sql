-- Limit repeated anonymous table-PIN guesses without storing raw IP addresses.
-- The Edge Function sends a SHA-256 fingerprint scoped to the session/table.
create table if not exists public.pin_claim_rate_limits (
  fingerprint text primary key check (fingerprint ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  failure_count integer not null default 0 check (failure_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.pin_claim_rate_limits enable row level security;
create index if not exists pin_claim_rate_limits_updated_at_idx
  on public.pin_claim_rate_limits (updated_at);
create or replace function public.claim_lab_table_anonymous_limited(
  p_session_id uuid,
  p_table_id uuid,
  p_claim_token_hash text,
  p_pin text,
  p_rate_limit_key text
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  existing_assignment public.student_table_assignments%rowtype;
  attempt public.pin_claim_rate_limits%rowtype;
  next_failure_count integer;
  next_blocked_until timestamptz;
begin
  if p_claim_token_hash !~ '^[0-9a-f]{64}$' then
    return 'invalid_claim_token';
  end if;
  if p_rate_limit_key !~ '^[0-9a-f]{64}$' then
    return 'invalid_rate_limit_key';
  end if;

  if not exists (
    select 1 from public.lab_sessions
    where id = p_session_id and status = 'open'
  ) then
    return 'session_not_open';
  end if;

  insert into public.pin_claim_rate_limits (fingerprint)
  values (p_rate_limit_key)
  on conflict (fingerprint) do nothing;

  select * into attempt
  from public.pin_claim_rate_limits
  where fingerprint = p_rate_limit_key
  for update;

  if attempt.blocked_until is not null and attempt.blocked_until > now() then
    return 'too_many_attempts';
  end if;

  if not exists (
    select 1 from public.lab_tables
    where id = p_table_id
      and session_id = p_session_id
      and pin_hash = crypt(p_pin, pin_hash)
  ) then
    next_failure_count := case
      when attempt.window_started_at < now() - interval '10 minutes' then 1
      else attempt.failure_count + 1
    end;
    next_blocked_until := case
      when next_failure_count >= 10 then now() + interval '15 minutes'
      else null
    end;

    update public.pin_claim_rate_limits
    set window_started_at = case
          when attempt.window_started_at < now() - interval '10 minutes' then now()
          else attempt.window_started_at
        end,
        failure_count = next_failure_count,
        blocked_until = next_blocked_until,
        updated_at = now()
    where fingerprint = p_rate_limit_key;

    if next_blocked_until is not null then
      return 'too_many_attempts';
    end if;
    return 'invalid_table_or_pin';
  end if;

  delete from public.pin_claim_rate_limits where fingerprint = p_rate_limit_key;
  delete from public.pin_claim_rate_limits where updated_at < now() - interval '30 days';

  select * into existing_assignment
  from public.student_table_assignments
  where session_id = p_session_id and table_id = p_table_id
  for update;

  if existing_assignment.id is not null then
    if existing_assignment.claim_token_hash = p_claim_token_hash then
      return 'ok';
    end if;

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

  begin
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
  exception when unique_violation then
    return 'table_already_claimed';
  end;

  return 'ok';
end;
$$;
revoke all on function public.claim_lab_table_anonymous_limited(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_lab_table_anonymous_limited(uuid, uuid, text, text, text)
  to service_role;
