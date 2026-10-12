alter table public.lab_sessions
  alter column require_student_pin set default false;

update public.lab_sessions
set require_student_pin = false
where require_student_pin = true;
