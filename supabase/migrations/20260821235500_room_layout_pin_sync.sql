-- Room layouts are the source of truth for which permanent table PINs exist.
-- Existing PINs for labels that remain in the selected layout are preserved;
-- missing labels are created, and labels outside the layout are removed.
alter table public.lab_sessions
  add column if not exists room_layout_id text;

update public.lab_sessions
set room_layout_id = '2568'
where room_layout_id is null;

create or replace function public.sync_permanent_table_pins(p_labels text[])
returns table(table_label text, pin_code text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_labels is null or cardinality(p_labels) < 1 or cardinality(p_labels) > 200 then
    raise exception 'invalid_room_layout';
  end if;

  if exists (
    select 1
    from unnest(p_labels) as value(label)
    where char_length(trim(label)) < 1 or char_length(trim(label)) > 30
  ) then
    raise exception 'invalid_room_layout';
  end if;

  if (
    select count(distinct trim(label))
    from unnest(p_labels) as value(label)
  ) <> cardinality(p_labels) then
    raise exception 'duplicate_room_table';
  end if;

  insert into public.permanent_table_pins (table_label, pin_code)
  select trim(label), (100000 + floor(random() * 900000))::integer::text
  from unnest(p_labels) as value(label)
  on conflict (table_label) do nothing;

  delete from public.permanent_table_pins as pin
  where not (pin.table_label = any(p_labels));

  return query
  select pin.table_label, pin.pin_code
  from public.permanent_table_pins as pin
  where pin.table_label = any(p_labels);
end;
$$;

revoke all on function public.sync_permanent_table_pins(text[]) from public, anon, authenticated;
grant execute on function public.sync_permanent_table_pins(text[]) to service_role;
