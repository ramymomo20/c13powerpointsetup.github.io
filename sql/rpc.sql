create or replace function public.log_display_block_change(
  p_from_block text,
  p_to_block text,
  p_mode text,
  p_effective_timestamp timestamptz,
  p_timezone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.event_log (
    event_type,
    event_source,
    payload
  )
  values (
    'display_block_changed',
    'display_page',
    jsonb_build_object(
      'from_block', p_from_block,
      'to_block', p_to_block,
      'mode', p_mode,
      'effective_timestamp', p_effective_timestamp,
      'timezone', p_timezone
    )
  );
end;
$$;

revoke all on function public.log_display_block_change(text, text, text, timestamptz, text) from public;
grant execute on function public.log_display_block_change(text, text, text, timestamptz, text) to anon, authenticated;
