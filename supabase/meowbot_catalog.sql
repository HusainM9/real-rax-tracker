-- Shared Meowbot RAX catalog.
-- Run this in the Supabase SQL editor for the project backing the catalog APIs.

create table if not exists public.meowbot_passes (
  external_key text primary key,
  entity_id integer not null,
  pass_kind text not null check (pass_kind in ('player', 'team')),
  sport text not null,
  season_year integer not null,
  season_label text not null,
  name text not null,
  rarity_label text,
  has_earnings boolean not null default true,
  total_base_rax numeric not null default 0 check (total_base_rax >= 0),
  source_updated_at timestamptz,
  cached_at timestamptz not null default now()
);

create table if not exists public.meowbot_daily_earnings (
  external_key text not null references public.meowbot_passes(external_key) on delete cascade,
  claim_day date not null,
  base_rax_earned numeric not null check (base_rax_earned > 0),
  player_box_score_id bigint,
  cached_at timestamptz not null default now(),
  primary key (external_key, claim_day)
);

create index if not exists meowbot_passes_name_lower_idx
  on public.meowbot_passes (lower(name));

create index if not exists meowbot_passes_sport_season_idx
  on public.meowbot_passes (sport, season_year);

create index if not exists meowbot_passes_has_earnings_idx
  on public.meowbot_passes (has_earnings);

-- Existing projects: run once in the SQL editor after the initial create.
-- alter table public.meowbot_passes
--   add column if not exists has_earnings boolean not null default true;
-- alter table public.meowbot_passes
--   add column if not exists total_base_rax numeric not null default 0 check (total_base_rax >= 0);
-- update public.meowbot_passes p
-- set total_base_rax = coalesce((
--   select sum(d.base_rax_earned)
--   from public.meowbot_daily_earnings d
--   where d.external_key = p.external_key
-- ), 0);

create index if not exists meowbot_daily_earnings_external_day_idx
  on public.meowbot_daily_earnings (external_key, claim_day desc);

