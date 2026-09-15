alter table public.lab_sessions
  add column if not exists require_student_pin boolean not null default true,
  add column if not exists student_access_version integer not null default 1
    check (student_access_version > 0);

alter table public.student_table_assignments
  add column if not exists student_email text,
  add column if not exists auth_version integer not null default 1,
  add column if not exists released_at timestamptz,
  add column if not exists release_reason text;

alter table public.student_table_assignments
  drop constraint if exists student_table_assignments_student_email_check;

alter table public.student_table_assignments
  add constraint student_table_assignments_student_email_check
  check (
    student_email is null
    or (
      student_email = lower(trim(student_email))
      and split_part(student_email, '@', 2) = 'student.chula.ac.th'
    )
  );

alter table public.student_table_assignments
  drop constraint if exists student_table_assignments_release_reason_check;

alter table public.student_table_assignments
  add constraint student_table_assignments_release_reason_check
  check (
    release_reason is null
    or release_reason in (
      'student_logout',
      'admin_release',
      'force_logout',
      'legacy_migration',
      'legacy_replaced'
    )
  );

-- Retire anonymous browser-token assignments when authenticated student access
-- is introduced. Waiting help requests remain untouched.
update public.student_table_assignments
set released_at = coalesce(released_at, now()),
    release_reason = coalesce(release_reason, 'legacy_migration')
where released_at is null
  and (user_id is null or claim_token_hash is not null);

alter table public.student_table_assignments
  drop constraint if exists student_table_assignments_session_id_user_id_key;

alter table public.student_table_assignments
  drop constraint if exists student_table_assignments_session_id_table_id_key;

create unique index if not exists student_table_assignments_active_user_idx
  on public.student_table_assignments (session_id, user_id)
  where released_at is null and user_id is not null;

create unique index if not exists student_table_assignments_active_table_idx
  on public.student_table_assignments (session_id, table_id)
  where released_at is null;

create or replace function public.claim_lab_table_authenticated(
  p_session_id uuid,
  p_table_id uuid,
  p_user_id uuid,
  p_student_email text,
  p_pin text
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  normalized_email text := lower(trim(p_student_email));
  pin_required boolean;
  access_version integer;
  existing_user_assignment public.student_table_assignments%rowtype;
  existing_table_assignment public.student_table_assignments%rowtype;
begin
  if split_part(normalized_email, '@', 2) <> 'student.chula.ac.th' then
    return 'invalid_student_email';
  end if;

  select require_student_pin, student_access_version
  into pin_required, access_version
  from public.lab_sessions
  where id = p_session_id and status = 'open';

  if not found then
    return 'session_not_open';
  end if;

  if not exists (
    select 1
    from public.lab_tables
    where id = p_table_id and session_id = p_session_id
  ) then
    return 'invalid_table';
  end if;

  if pin_required and not exists (
    select 1
    from public.lab_tables
    where id = p_table_id
      and session_id = p_session_id
      and pin_hash = crypt(coalesce(p_pin, ''), pin_hash)
  ) then
    return 'invalid_table_or_pin';
  end if;

  select * into existing_user_assignment
  from public.student_table_assignments
  where session_id = p_session_id
    and user_id = p_user_id
    and released_at is null
  for update;

  if existing_user_assignment.id is not null then
    if existing_user_assignment.table_id = p_table_id then
      update public.student_table_assignments
      set student_email = normalized_email,
          auth_version = access_version
      where id = existing_user_assignment.id;
      return 'ok';
    end if;
    return 'user_already_assigned';
  end if;

  select * into existing_table_assignment
  from public.student_table_assignments
  where session_id = p_session_id
    and table_id = p_table_id
    and released_at is null
  for update;

  if existing_table_assignment.id is not null then
    if existing_table_assignment.user_id = p_user_id then
      return 'ok';
    end if;

    if existing_table_assignment.user_id is null then
      update public.student_table_assignments
      set released_at = now(),
          release_reason = 'legacy_replaced'
      where id = existing_table_assignment.id;
    else
      return 'table_already_claimed';
    end if;
  end if;

  begin
    insert into public.student_table_assignments (
      session_id,
      table_id,
      user_id,
      student_email,
      auth_version,
      claim_token_hash
    ) values (
      p_session_id,
      p_table_id,
      p_user_id,
      normalized_email,
      access_version,
      null
    );
  exception when unique_violation then
    return 'table_already_claimed';
  end;

  return 'ok';
end;
$$;

revoke all on function public.claim_lab_table_authenticated(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_lab_table_authenticated(uuid, uuid, uuid, text, text)
  to service_role;

create or replace function public.force_logout_lab_students(p_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  released_count integer;
begin
  update public.student_table_assignments
  set released_at = now(),
      release_reason = 'force_logout'
  where session_id = p_session_id
    and released_at is null;
  get diagnostics released_count = row_count;

  update public.lab_sessions
  set student_access_version = student_access_version + 1
  where id = p_session_id;
  if not found then
    raise exception 'session_not_found';
  end if;

  return released_count;
end;
$$;

revoke all on function public.force_logout_lab_students(uuid)
  from public, anon, authenticated;
grant execute on function public.force_logout_lab_students(uuid)
  to service_role;

revoke select on public.app_events from anon;
drop policy if exists "anonymous clients can receive app events" on public.app_events;
