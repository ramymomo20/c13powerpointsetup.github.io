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
