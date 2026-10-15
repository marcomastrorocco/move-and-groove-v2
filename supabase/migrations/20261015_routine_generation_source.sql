-- Existing routines have unknown provenance; leave historical rows NULL.
alter table public.routines
  add column if not exists generation_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.routines'::regclass
      and conname = 'routines_generation_source_check'
  ) then
    alter table public.routines
      add constraint routines_generation_source_check
      check (generation_source in ('openai', 'claude', 'curated_fallback'));
  end if;
end $$;
