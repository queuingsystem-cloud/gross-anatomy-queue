create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'instructor')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

create or replace function public.create_lab_table_with_pin(
  p_session_id uuid,
  p_label text,
  p_zone text,
  p_sort_order integer,
  p_pin text
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_id uuid;
begin
  insert into public.lab_tables (session_id, label, zone, sort_order, pin_hash)
  values (p_session_id, trim(p_label), nullif(trim(p_zone), ''), p_sort_order, crypt(p_pin, gen_salt('bf')))
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.create_lab_table_with_pin(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.create_lab_table_with_pin(uuid, text, text, integer, text) to service_role;

create or replace function public.open_lab_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lab_sessions set status = 'closed' where status = 'open' and id <> p_session_id;
  update public.lab_sessions set status = 'open' where id = p_session_id;
  if not found then raise exception 'session_not_found'; end if;
end;
$$;

revoke all on function public.open_lab_session(uuid) from public, anon, authenticated;
grant execute on function public.open_lab_session(uuid) to service_role;
