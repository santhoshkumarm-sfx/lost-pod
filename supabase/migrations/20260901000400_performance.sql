-- =====================================================================
-- Performance: evaluate role checks and "today" once per query, not once per row.
-- Same rules as before — only how Postgres evaluates them changes. (With 6,500 cases the
-- dashboard statistics went from ~6.6 s to well under a second.)
-- =====================================================================

-- ---------- Row Level Security: wrap helper calls in (select …) so they run once per statement ----------
drop policy if exists status_master_read on public.status_master;
create policy status_master_read on public.status_master for select to authenticated using ((select public.app_role()) is not null);
drop policy if exists status_master_write on public.status_master;
create policy status_master_write on public.status_master for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists aging_buckets_read on public.aging_buckets;
create policy aging_buckets_read on public.aging_buckets for select to authenticated using ((select public.app_role()) is not null);
drop policy if exists aging_buckets_write on public.aging_buckets;
create policy aging_buckets_write on public.aging_buckets for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists status_mappings_read on public.status_mappings;
create policy status_mappings_read on public.status_mappings for select to authenticated using ((select public.is_internal()));
drop policy if exists status_mappings_write on public.status_mappings;
create policy status_mappings_write on public.status_mappings for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists column_aliases_read on public.column_aliases;
create policy column_aliases_read on public.column_aliases for select to authenticated using ((select public.is_internal()));
drop policy if exists column_aliases_write on public.column_aliases;
create policy column_aliases_write on public.column_aliases for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated using ((select public.is_internal()));
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated
  using ((select public.is_internal()) or id in (select public.poc_client_ids()));
drop policy if exists clients_write on public.clients;
create policy clients_write on public.clients for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_internal()));
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists client_pocs_read on public.client_pocs;
create policy client_pocs_read on public.client_pocs for select to authenticated
  using ((select public.is_internal()) or client_id in (select public.poc_client_ids()));
drop policy if exists client_pocs_write on public.client_pocs;
create policy client_pocs_write on public.client_pocs for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists sheet_sources_read on public.sheet_sources;
create policy sheet_sources_read on public.sheet_sources for select to authenticated using ((select public.is_internal()));
drop policy if exists sheet_sources_write on public.sheet_sources;
create policy sheet_sources_write on public.sheet_sources for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists sync_runs_read on public.sync_runs;
create policy sync_runs_read on public.sync_runs for select to authenticated using ((select public.is_internal()));
drop policy if exists emails_read on public.emails;
create policy emails_read on public.emails for select to authenticated using ((select public.is_internal()));
drop policy if exists emails_insert on public.emails;
create policy emails_insert on public.emails for insert to authenticated with check ((select public.is_internal()));
drop policy if exists emails_update on public.emails;
create policy emails_update on public.emails for update to authenticated using ((select public.is_internal())) with check ((select public.is_internal()));
drop policy if exists source_records_read on public.source_records;
create policy source_records_read on public.source_records for select to authenticated using ((select public.is_internal()));
drop policy if exists source_records_insert on public.source_records;
create policy source_records_insert on public.source_records for insert to authenticated with check ((select public.is_internal()));
drop policy if exists cases_read on public.cases;
create policy cases_read on public.cases for select to authenticated
  using ((select public.is_internal()) or (client_id is not null and client_id in (select public.poc_client_ids())));
drop policy if exists cases_insert on public.cases;
create policy cases_insert on public.cases for insert to authenticated
  with check ((select public.is_internal()));
drop policy if exists cases_update on public.cases;
create policy cases_update on public.cases for update to authenticated
  using ((select public.is_admin()) or ((select public.app_role()) = 'internal_team' and (assigned_agent = (select auth.uid()) or assigned_agent is null)))
  with check ((select public.is_admin()) or ((select public.app_role()) = 'internal_team' and (assigned_agent = (select auth.uid()) or assigned_agent is null)));
drop policy if exists case_private_rw on public.case_private;
create policy case_private_rw on public.case_private for all to authenticated
  using ((select public.is_internal())) with check ((select public.is_internal()));
drop policy if exists case_updates_read on public.case_updates;
create policy case_updates_read on public.case_updates for select to authenticated
  using ((select public.is_internal())
         or (client_visible and case_id in (select id from public.cases where client_id in (select public.poc_client_ids()))));
drop policy if exists case_comments_read on public.case_comments;
create policy case_comments_read on public.case_comments for select to authenticated
  using ((select public.is_internal())
         or (visibility = 'client' and case_id in (select id from public.cases where client_id in (select public.poc_client_ids()))));
drop policy if exists case_comments_insert_internal on public.case_comments;
create policy case_comments_insert_internal on public.case_comments for insert to authenticated
  with check ((select public.is_internal()) and user_id = (select auth.uid()));
drop policy if exists case_comments_insert_poc on public.case_comments;
create policy case_comments_insert_poc on public.case_comments for insert to authenticated
  with check ((select public.app_role()) = 'client_poc' and user_id = (select auth.uid()) and visibility = 'client'
              and case_id in (select id from public.cases where client_id in (select public.poc_client_ids())));
drop policy if exists lost_approvals_read on public.lost_approvals;
create policy lost_approvals_read on public.lost_approvals for select to authenticated
  using ((select public.is_internal())
         or case_id in (select id from public.cases where client_id in (select public.poc_client_ids())));
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists audit_logs_read on public.audit_logs;
create policy audit_logs_read on public.audit_logs for select to authenticated using ((select public.is_admin()));
drop policy if exists report_runs_read on public.report_runs;
create policy report_runs_read on public.report_runs for select to authenticated using ((select public.is_admin()));

-- ---------- Case view: "today" and the default SLA are read once, aging buckets joined once ----------
create or replace view public.v_cases with (security_invoker = true) as
with cfg as materialized (
  select public.app_today() as today, public.app_setting_int('default_sla_days', 7) as default_sla
),
buckets as materialized (
  select label, min_days, max_days, sort_order from public.aging_buckets
)
select
  c.*,
  coalesce(cl.name, c.client_name)              as client_display_name,
  cl.sla_days                                    as client_sla_days,
  ag.full_name                                   as agent_name,
  coalesce(ag.full_name, c.assigned_agent_name)  as agent_display_name,
  poc.name                                       as poc_name,
  sm.label                                       as status_label,
  sm.category                                    as status_category,
  sm.color                                       as status_color,
  a.current_aging_days,
  a.aging_days,
  b.label                                        as aging_bucket,
  b.sort_order                                   as aging_bucket_order,
  (sm.category in ('open', 'lost_pending') and a.current_aging_days > coalesce(cl.sla_days, cfg.default_sla)) as sla_breached
from public.cases c
cross join cfg
join public.status_master sm on sm.code = c.team_status
left join public.clients cl on cl.id = c.client_id
left join public.profiles ag on ag.id = c.assigned_agent
left join public.client_pocs poc on poc.id = c.client_poc_id
cross join lateral (
  select greatest(cfg.today - c.escalation_date, 0) as current_aging_days,
         case when sm.category in ('closed', 'lost') and c.final_aging_days is not null
              then c.final_aging_days else greatest(cfg.today - c.escalation_date, 0) end as aging_days
) a
left join buckets b on a.aging_days >= b.min_days and (b.max_days is null or a.aging_days <= b.max_days)
where not c.is_deleted;

-- ---------- Dashboard statistics: one pass over a slim, materialised set ----------
create or replace function public.case_stats(p_client_id uuid default null, p_from date default null, p_to date default null,
                                             p_source text default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with base as materialized (
    select client_id, client_display_name, team_status, status_category, sla_breached, escalation_date,
           aging_bucket, hub, location, agent_display_name, aging_days, source_type
    from public.v_cases
    where (p_client_id is null or client_id = p_client_id)
      and (p_from is null or escalation_date >= p_from)
      and (p_to is null or escalation_date <= p_to)
      and (p_source is null or source_type::text = p_source)
  ),
  open_cases as materialized (select * from base where status_category in ('open', 'lost_pending')),
  today as (select public.app_today() as d),
  totals as (
    select count(*) as total,
           count(*) filter (where status_category in ('open', 'lost_pending')) as open,
           count(*) filter (where sla_breached) as sla_breached,
           count(*) filter (where escalation_date >= (select d from today) - 1) as new_today
    from base
  )
  select jsonb_build_object(
    'total', t.total, 'open', t.open, 'sla_breached', t.sla_breached, 'new_today', t.new_today,
    'by_status', coalesce((select jsonb_agg(jsonb_build_object('code', sm.code, 'label', sm.label, 'category', sm.category,
                                                               'color', sm.color, 'count', coalesce(x.n, 0)) order by sm.sort_order)
                  from public.status_master sm
                  left join (select team_status, count(*) n from base group by team_status) x on x.team_status = sm.code
                  where sm.is_active), '[]'::jsonb),
    'by_aging', coalesce((select jsonb_agg(jsonb_build_object('label', ab.label, 'count', coalesce(x.n, 0)) order by ab.sort_order)
                  from public.aging_buckets ab
                  left join (select aging_bucket, count(*) n from open_cases group by aging_bucket) x on x.aging_bucket = ab.label), '[]'::jsonb),
    'by_client', coalesce((select jsonb_agg(c order by c.open desc, c.total desc) from (
                  select coalesce(client_display_name, 'Unassigned') as client, client_id,
                         count(*) as total,
                         count(*) filter (where status_category in ('open', 'lost_pending')) as open,
                         count(*) filter (where team_status = 'pending') as pending,
                         count(*) filter (where team_status = 'lost_pending_approval') as lost_pending,
                         count(*) filter (where team_status = 'lost') as lost,
                         count(*) filter (where team_status = 'pod_shared') as pod_shared,
                         count(*) filter (where sla_breached) as sla_breached
                  from base group by 1, 2) c), '[]'::jsonb),
    'by_hub', coalesce((select jsonb_agg(h order by h.open desc) from (
                  select coalesce(hub, location, 'Unknown') as hub, count(*) as open,
                         count(*) filter (where sla_breached) as sla_breached
                  from open_cases group by 1 order by 2 desc limit 15) h), '[]'::jsonb),
    'by_agent', coalesce((select jsonb_agg(g order by g.open desc) from (
                  select coalesce(agent_display_name, 'Unassigned') as agent, count(*) as open,
                         count(*) filter (where sla_breached) as sla_breached,
                         round(avg(aging_days)::numeric, 1) as avg_aging
                  from open_cases group by 1 order by 2 desc limit 15) g), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', s, 'total', coalesce(x.total, 0), 'open', coalesce(x.open, 0)))
                  from unnest(array['google_sheet', 'email', 'manual']) s
                  left join (select source_type::text st, count(*) total,
                                    count(*) filter (where status_category in ('open', 'lost_pending')) open
                             from base group by 1) x on x.st = s), '[]'::jsonb)
  )
  from totals t
$$;

-- ---------- Indexes for the commonest filters and the per-client POC lookup ----------
create index if not exists cases_active_esc_idx on public.cases (escalation_date) where not is_deleted;
create index if not exists cases_client_idx on public.cases (client_id) where not is_deleted;
create index if not exists client_pocs_user_active_idx on public.client_pocs (user_id, client_id) where is_active;
create index if not exists case_updates_case_created_idx on public.case_updates (case_id, created_at desc);
