create extension if not exists pgcrypto;

create table if not exists public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  day_of_week smallint not null check (day_of_week between 0 and 6),
  period text not null check (period in ('morning', 'evening')),
  title text not null default 'Today''s Events',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_email text,
  unique (day_of_week, period)
);

create table if not exists public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  schedule_block_id uuid not null references public.schedule_blocks(id) on delete cascade,
  room_name text not null,
  start_time_text text,
  end_time_text text,
  event_title text not null,
  building_name text,
  notes text,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_email text
);

create table if not exists public.event_log (
  id bigserial primary key,
  event_type text not null,
  event_source text not null default 'app',
  actor_user_id uuid,
  actor_email text,
  block_id uuid,
  item_id uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_schedule_items_block_order
  on public.schedule_items (schedule_block_id, sort_order);

create index if not exists idx_event_log_created_at
  on public.event_log (created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_schedule_blocks on public.schedule_blocks;
create trigger trg_touch_schedule_blocks
before update on public.schedule_blocks
for each row
execute function public.touch_updated_at();

drop trigger if exists trg_touch_schedule_items on public.schedule_items;
create trigger trg_touch_schedule_items
before update on public.schedule_items
for each row
execute function public.touch_updated_at();

drop trigger if exists trg_touch_app_settings on public.app_settings;
create trigger trg_touch_app_settings
before update on public.app_settings
for each row
execute function public.touch_updated_at();

create or replace function public.current_actor_email()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'email', '');
$$;

create or replace function public.is_afscme13_editor()
returns boolean
language sql
stable
as $$
  select
    auth.role() = 'authenticated'
    and coalesce((auth.jwt() ->> 'email') ~* '^[^@]+@afscme13\.org$', false);
$$;

create or replace function public.log_mutation_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_type text;
  v_payload jsonb;
  v_block_id uuid;
  v_item_id uuid;
begin
  if tg_table_name = 'schedule_blocks' then
    v_event_type :=
      case tg_op
        when 'INSERT' then 'schedule_block_created'
        when 'UPDATE' then 'schedule_block_updated'
        when 'DELETE' then 'schedule_block_deleted'
      end;
    v_payload :=
      case tg_op
        when 'DELETE' then jsonb_build_object('old', to_jsonb(old))
        else jsonb_build_object('new', to_jsonb(new))
      end;
    v_block_id := case when tg_op = 'DELETE' then old.id else new.id end;
    v_item_id := null;
  elsif tg_table_name = 'schedule_items' then
    v_event_type :=
      case tg_op
        when 'INSERT' then 'schedule_item_created'
        when 'UPDATE' then 'schedule_item_updated'
        when 'DELETE' then 'schedule_item_deleted'
      end;
    v_payload :=
      case tg_op
        when 'DELETE' then jsonb_build_object('old', to_jsonb(old))
        else jsonb_build_object('new', to_jsonb(new))
      end;
    v_block_id := case when tg_op = 'DELETE' then old.schedule_block_id else new.schedule_block_id end;
    v_item_id := case when tg_op = 'DELETE' then old.id else new.id end;
  elsif tg_table_name = 'app_settings' then
    v_event_type := 'schedule_updated';
    v_payload :=
      case tg_op
        when 'DELETE' then jsonb_build_object('setting_key', old.key, 'old', old.value)
        else jsonb_build_object('setting_key', new.key, 'value', new.value)
      end;
    v_block_id := null;
    v_item_id := null;
  end if;

  insert into public.event_log (
    event_type,
    event_source,
    actor_user_id,
    actor_email,
    block_id,
    item_id,
    payload
  )
  values (
    v_event_type,
    'database_trigger',
    auth.uid(),
    public.current_actor_email(),
    v_block_id,
    v_item_id,
    v_payload
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_log_schedule_blocks on public.schedule_blocks;
create trigger trg_log_schedule_blocks
after insert or update or delete on public.schedule_blocks
for each row
execute function public.log_mutation_event();

drop trigger if exists trg_log_schedule_items on public.schedule_items;
create trigger trg_log_schedule_items
after insert or update or delete on public.schedule_items
for each row
execute function public.log_mutation_event();

drop trigger if exists trg_log_app_settings on public.app_settings;
create trigger trg_log_app_settings
after insert or update or delete on public.app_settings
for each row
execute function public.log_mutation_event();

grant usage on schema public to anon, authenticated;

grant select on public.schedule_blocks, public.schedule_items, public.app_settings to anon, authenticated;
grant insert, update, delete on public.schedule_blocks, public.schedule_items, public.app_settings to authenticated;
grant select, insert on public.event_log to authenticated;
