-- PREPARED ONLY: authorized SQL parity and EXPLAIN checks are still required.
-- DO NOT APPLY: atomic function creation + REVOKE/GRANT and real Postgres
-- permission/rollback checks are still required. Decide the index transaction /
-- CONCURRENTLY strategy separately; this draft is not approved for db push.
-- Candidate index for date scans; existing external-key-leading PK serves imports.
-- Retain only if EXPLAIN (ANALYZE, BUFFERS) confirms benefits on representative
-- 1/31/62-day ranges and sport/season/name filters. On a busy database schedule
-- separately or use CONCURRENTLY outside a migration transaction to avoid locks.
create index if not exists meowbot_daily_earnings_claim_day_external_key_idx
  on public.meowbot_daily_earnings (claim_day, external_key) include (base_rax_earned);

create or replace function public.catalog_range_totals_v1(
  p_start_date date, p_end_date date,
  p_sports text[] default '{}', p_season_years integer[] default '{}',
  p_pass_kind text default null, p_query text default '',
  p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog
as $$
declare result jsonb;
begin
  if p_start_date is null or p_end_date is null
     or p_end_date < p_start_date or p_end_date - p_start_date > 61 then
    raise exception 'Range must contain 1 to 62 days' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100
     or p_offset is null or p_offset < 0 or p_offset > 1000000
     or (p_pass_kind is not null and p_pass_kind not in ('player', 'team'))
     or coalesce(cardinality(p_sports), 0) > 20
     or coalesce(cardinality(p_season_years), 0) > 100
     or length(coalesce(p_query, '')) > 200 then
    raise exception 'Invalid catalog filters or pagination' using errcode = '22023';
  end if;
  with totals as materialized (
    select d.external_key, sum(d.base_rax_earned) as range_base_rax, count(*) as row_count
    from public.meowbot_daily_earnings d
    join public.meowbot_passes p on p.external_key = d.external_key
    where d.claim_day between p_start_date and p_end_date and d.base_rax_earned > 0
      and (coalesce(cardinality(p_sports), 0) = 0 or p.sport = any(p_sports))
      and (coalesce(cardinality(p_season_years), 0) = 0 or p.season_year = any(p_season_years))
      and (p_pass_kind is null or p.pass_kind = p_pass_kind)
      and (length(coalesce(p_query, '')) < 2 or p.name ilike '%' || replace(p_query, '*', ' ') || '%')
    group by d.external_key
  ), page as (
    select p.*, t.range_base_rax, t.row_count
    from totals t join public.meowbot_passes p using (external_key)
    order by t.range_base_rax desc, p.name, p.external_key
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(page) order by range_base_rax desc, name, external_key) from page), '[]'::jsonb),
    'total', (select count(*) from totals)
  ) into result;
  return result;
end;
$$;

revoke all on function public.catalog_range_totals_v1(date,date,text[],integer[],text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.catalog_range_totals_v1(date,date,text[],integer[],text,text,integer,integer) to service_role;
-- Rollback: unset CATALOG_RANGE_RPC_ENABLED first. Do not drop live objects until
-- traffic is confirmed on the bounded, explicitly partial fallback.
