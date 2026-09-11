-- Restore the 2569 room layout to eight snake-ordered rows of five tables.
-- Historical archived sessions are left unchanged. Existing table IDs, PINs,
-- assignments, and request history are preserved.
with current_layout_tables as (
  select
    table_row.id,
    table_row.label::integer as table_number
  from public.lab_tables as table_row
  join public.lab_sessions as session_row
    on session_row.id = table_row.session_id
  where session_row.room_layout_id = '2569'
    and session_row.archived_at is null
    and table_row.label ~ '^[0-9]+$'
    and table_row.label::integer between 1 and 40
)
update public.lab_tables as table_row
set
  zone = case
    when layout.table_number <= 10 then 'Zone A'
    when layout.table_number <= 20 then 'Zone B'
    when layout.table_number <= 30 then 'Zone C'
    else 'Zone D'
  end,
  sort_order = ((layout.table_number - 1) / 5) * 5
    + case
        when (((layout.table_number - 1) / 5) % 2) = 0
          then ((layout.table_number - 1) % 5) + 1
        else 5 - ((layout.table_number - 1) % 5)
      end
from current_layout_tables as layout
where table_row.id = layout.id;
