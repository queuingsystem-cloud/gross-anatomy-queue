-- Zone names are defined by each session's lab_tables rows. The original
-- prototype constraint only allowed A/B/C/D and rejects labels such as
-- "Zone A" as well as administrator-defined custom zones.
alter table public.help_requests
  drop constraint if exists help_requests_zone_check;
