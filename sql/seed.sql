insert into public.app_settings (key, value)
values
  ('display_timezone', '"America/New_York"'),
  ('morning_switch_time', '"05:00"'),
  ('evening_switch_time', '"17:00"'),
  ('display_refresh_seconds', '60'),
  ('display_title', '"Today''s Events"'),
  ('test_mode_enabled', 'false'),
  ('test_effective_timestamp', 'null'),
  ('test_override_day_of_week', 'null'),
  ('test_override_period', 'null'),
  ('test_morning_switch_time', 'null'),
  ('test_evening_switch_time', 'null')
on conflict (key)
do update set value = excluded.value;

insert into public.schedule_blocks (day_of_week, period, title, is_active)
select d.day_of_week, p.period, 'Today''s Events', true
from generate_series(0, 6) as d(day_of_week)
cross join (values ('morning'), ('evening')) as p(period)
on conflict (day_of_week, period) do nothing;

with monday_morning as (
  select id
  from public.schedule_blocks
  where day_of_week = 1 and period = 'morning'
  limit 1
),
friday_evening as (
  select id
  from public.schedule_blocks
  where day_of_week = 5 and period = 'evening'
  limit 1
)
insert into public.schedule_items (
  schedule_block_id,
  room_name,
  start_time_text,
  end_time_text,
  event_title,
  building_name,
  notes,
  sort_order,
  is_visible
)
select
  monday_morning.id,
  'Room A',
  '9:00 AM',
  '10:30 AM',
  'Leadership Meeting',
  'Main Office',
  'Weekly planning session',
  0,
  true
from monday_morning
union all
select
  friday_evening.id,
  'Auditorium',
  '5:30 PM',
  '7:00 PM',
  'Member Orientation',
  'Main Office',
  'Open to new members',
  0,
  true
from friday_evening;
