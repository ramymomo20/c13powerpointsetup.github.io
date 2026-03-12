alter table public.schedule_blocks enable row level security;
alter table public.schedule_items enable row level security;
alter table public.app_settings enable row level security;
alter table public.event_log enable row level security;

drop policy if exists schedule_blocks_public_read on public.schedule_blocks;
create policy schedule_blocks_public_read
on public.schedule_blocks
for select
using (true);

drop policy if exists schedule_blocks_editor_insert on public.schedule_blocks;
create policy schedule_blocks_editor_insert
on public.schedule_blocks
for insert
to authenticated
with check (public.is_afscme13_editor());

drop policy if exists schedule_blocks_editor_update on public.schedule_blocks;
create policy schedule_blocks_editor_update
on public.schedule_blocks
for update
to authenticated
using (public.is_afscme13_editor())
with check (public.is_afscme13_editor());

drop policy if exists schedule_blocks_editor_delete on public.schedule_blocks;
create policy schedule_blocks_editor_delete
on public.schedule_blocks
for delete
to authenticated
using (public.is_afscme13_editor());

drop policy if exists schedule_items_public_read on public.schedule_items;
create policy schedule_items_public_read
on public.schedule_items
for select
using (true);

drop policy if exists schedule_items_editor_insert on public.schedule_items;
create policy schedule_items_editor_insert
on public.schedule_items
for insert
to authenticated
with check (public.is_afscme13_editor());

drop policy if exists schedule_items_editor_update on public.schedule_items;
create policy schedule_items_editor_update
on public.schedule_items
for update
to authenticated
using (public.is_afscme13_editor())
with check (public.is_afscme13_editor());

drop policy if exists schedule_items_editor_delete on public.schedule_items;
create policy schedule_items_editor_delete
on public.schedule_items
for delete
to authenticated
using (public.is_afscme13_editor());

drop policy if exists app_settings_public_read on public.app_settings;
create policy app_settings_public_read
on public.app_settings
for select
using (true);

drop policy if exists app_settings_editor_insert on public.app_settings;
create policy app_settings_editor_insert
on public.app_settings
for insert
to authenticated
with check (public.is_afscme13_editor());

drop policy if exists app_settings_editor_update on public.app_settings;
create policy app_settings_editor_update
on public.app_settings
for update
to authenticated
using (public.is_afscme13_editor())
with check (public.is_afscme13_editor());

drop policy if exists app_settings_editor_delete on public.app_settings;
create policy app_settings_editor_delete
on public.app_settings
for delete
to authenticated
using (public.is_afscme13_editor());

drop policy if exists event_log_editor_select on public.event_log;
create policy event_log_editor_select
on public.event_log
for select
to authenticated
using (public.is_afscme13_editor());

drop policy if exists event_log_editor_insert on public.event_log;
create policy event_log_editor_insert
on public.event_log
for insert
to authenticated
with check (public.is_afscme13_editor());
