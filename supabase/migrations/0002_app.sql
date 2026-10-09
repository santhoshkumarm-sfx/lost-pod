-- =====================================================================
-- Lost & POD desk — part 2: everything added after the base schema.
-- Safe to run again at any time (setup runs it whenever it changes): it only creates what is missing
-- and replaces functions and views. Automatic emails start switched OFF; a Super Admin turns them on in Settings.
-- =====================================================================

-- ######## speed ########
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

-- ######## lost approvers, routing, reports ########
-- =====================================================================
-- Lost approver rights (per user, optionally per client), email routing and report schedules,
-- filtered statistics, bulk Lost requests/decisions that skip what a user may not do.
-- =====================================================================

-- ---------- Helpers ----------
create or replace function public.split_awbs(p text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct upper(t)) filter (where t <> ''), '{}')
  from regexp_split_to_table(coalesce(p, ''), '[\s,;]+') t
$$;

-- ---------- Who may decide Lost requests ----------
-- A row with client_id NULL = may approve for every client. Super Admins can always approve.
create table if not exists public.lost_approvers (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  client_id  uuid references public.clients (id) on delete cascade,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create unique index if not exists lost_approvers_user_client_uq
  on public.lost_approvers (user_id, coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.lost_approvers enable row level security;
drop policy if exists lost_approvers_read on public.lost_approvers;
create policy lost_approvers_read on public.lost_approvers for select to authenticated using ((select public.is_internal()));
drop policy if exists lost_approvers_write on public.lost_approvers;
create policy lost_approvers_write on public.lost_approvers for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
drop trigger if exists audit_lost_approvers on public.lost_approvers;
create trigger audit_lost_approvers after insert or update or delete on public.lost_approvers
  for each row execute function public.audit_row();

create or replace function public.can_approve_lost(p_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_super_admin(), false)
      or exists (
        select 1 from public.lost_approvers la
        join public.profiles p on p.id = la.user_id
        where la.user_id = auth.uid() and p.is_active and p.role in ('super_admin', 'admin', 'internal_team')
          and (la.client_id is null or la.client_id = p_client_id))
$$;

-- Approvers (for this client) and Super Admins — used for notifications and request emails.
create or replace function public.lost_approver_emails(p_client_id uuid)
returns table (user_id uuid, email text, full_name text)
language sql stable security definer set search_path = public as $$
  select distinct p.id, p.email, p.full_name
  from public.profiles p
  left join public.lost_approvers la on la.user_id = p.id
  where p.is_active
    and (p.role = 'super_admin'
         or (p.role in ('admin', 'internal_team') and la.id is not null and (la.client_id is null or la.client_id = p_client_id)))
$$;
revoke execute on function public.lost_approver_emails(uuid) from public, anon;
grant execute on function public.lost_approver_emails(uuid) to authenticated, service_role;

create or replace function public.reopen_lost_case(p_case_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_approve_lost((select client_id from public.cases where id = p_case_id)) then
    raise exception 'NOT_APPROVER: Only a Lost approver for this client can reopen a Lost case';
  end if;
  if public.status_category_of(p_status) in ('lost', 'lost_pending') or public.status_category_of(p_status) is null then
    raise exception 'Choose a non-Lost status';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Give a reason for reopening'; end if;
  update public.lost_approvals set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
         decision_note = trim(p_note)
   where case_id = p_case_id and status = 'pending';
  perform set_config('app.lost_flow', 'on', true);
  update public.cases set team_status = p_status, lost_approved_at = null, lost_approved_by = null,
         lost_requested_at = null, last_change_source = 'app'
   where id = p_case_id;
  perform set_config('app.lost_flow', 'off', true);
  insert into public.case_updates (case_id, action, note, source, client_visible, user_id)
  values (p_case_id, 'lost_reopened', trim(p_note), 'app', true, auth.uid());
end $$;

create or replace function public.case_stats_f(p jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path = public as $$
  with base as materialized (
    select v.client_id, v.client_display_name, v.team_status, v.status_category, v.sla_breached, v.escalation_date,
           v.aging_bucket, v.hub, v.location, v.agent_display_name, v.aging_days, v.source_type
    from public.v_cases v
    where (nullif(p ->> 'client', '') is null
           or (p ->> 'client' = 'none' and v.client_id is null)
           or v.client_id::text = p ->> 'client')
      and (nullif(p ->> 'source', '') is null or v.source_type::text = p ->> 'source')
      and (nullif(p ->> 'from', '') is null or v.escalation_date >= (p ->> 'from')::date)
      and (nullif(p ->> 'to', '') is null or v.escalation_date <= (p ->> 'to')::date)
      and (nullif(p ->> 'hub', '') is null or v.hub ilike '%' || (p ->> 'hub') || '%' or v.location ilike '%' || (p ->> 'hub') || '%')
      and (nullif(p ->> 'agent', '') is null
           or (p ->> 'agent' = 'unassigned' and v.assigned_agent is null)
           or v.assigned_agent::text = p ->> 'agent')
      and (nullif(p ->> 'poc', '') is null or v.client_poc_id::text = p ->> 'poc')
      and (nullif(p ->> 'status', '') is null or v.team_status = p ->> 'status')
      and (nullif(p ->> 'category', '') is null or p ->> 'category' = 'all'
           or (p ->> 'category' = 'active' and v.status_category in ('open', 'lost_pending'))
           or v.status_category::text = p ->> 'category')
      and (nullif(p ->> 'aging', '') is null or v.aging_bucket = p ->> 'aging')
      and (coalesce(p ->> 'sla', '') <> '1' or v.sla_breached)
      and (nullif(p ->> 'reason', '') is null or v.reason ilike '%' || (p ->> 'reason') || '%')
      and (nullif(p ->> 'q', '') is null
           or (cardinality(public.split_awbs(p ->> 'q')) > 1 and v.awb = any (public.split_awbs(p ->> 'q')))
           or (cardinality(public.split_awbs(p ->> 'q')) <= 1 and (
                 v.awb ilike '%' || (p ->> 'q') || '%' or v.client_display_name ilike '%' || (p ->> 'q') || '%'
                 or v.email_subject ilike '%' || (p ->> 'q') || '%' or v.hub ilike '%' || (p ->> 'q') || '%'
                 or v.location ilike '%' || (p ->> 'q') || '%' or v.poc_name ilike '%' || (p ->> 'q') || '%'
                 or v.agent_display_name ilike '%' || (p ->> 'q') || '%' or v.seller_name ilike '%' || (p ->> 'q') || '%'
                 or v.order_id ilike '%' || (p ->> 'q') || '%')))
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

-- Bulk decisions: decide what this user may decide, report the rest instead of failing everything.
drop function if exists public.decide_lost_bulk(uuid[], text, text);
create or replace function public.decide_lost_bulk(p_approval_ids uuid[], p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_done uuid[] := '{}';
  v_skipped int := 0;
  v_first_error text;
begin
  if public.app_role() is null or not public.is_internal() then raise exception 'Not allowed'; end if;
  foreach v_id in array p_approval_ids loop
    begin
      perform public.decide_lost(v_id, p_decision, p_note);
      v_done := v_done || v_id;
    exception when others then
      v_skipped := v_skipped + 1;
      v_first_error := coalesce(v_first_error, regexp_replace(sqlerrm, '^NOT_APPROVER: ', ''));
    end;
  end loop;
  return jsonb_build_object('done', cardinality(v_done), 'done_ids', to_jsonb(v_done), 'skipped', v_skipped, 'first_error', v_first_error);
end $$;
revoke execute on function public.decide_lost_bulk(uuid[], text, text) from public, anon;
grant execute on function public.decide_lost_bulk(uuid[], text, text) to authenticated;
grant execute on function public.can_approve_lost(uuid) to authenticated;

-- Bulk Lost requests (internal team and client POCs): each case is checked by request_lost().
create or replace function public.request_lost_bulk(p_case_ids uuid[], p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_done uuid[] := '{}';
  v_skipped int := 0;
  v_first_error text;
begin
  foreach v_id in array p_case_ids loop
    begin
      perform public.request_lost(v_id, p_reason);
      v_done := v_done || v_id;
    exception when others then
      v_skipped := v_skipped + 1;
      v_first_error := coalesce(v_first_error, sqlerrm);
    end;
  end loop;
  return jsonb_build_object('done', cardinality(v_done), 'done_ids', to_jsonb(v_done), 'skipped', v_skipped, 'first_error', v_first_error);
end $$;
revoke execute on function public.request_lost_bulk(uuid[], text) from public, anon;
grant execute on function public.request_lost_bulk(uuid[], text) to authenticated;

-- ---------- Email routing & schedules (Settings) ----------
insert into public.app_settings (key, value, description) values
  ('lost_request_email_to',  '["naveed.iqbal@shadowfax.in"]', 'Lost requests are emailed to these addresses (plus the approvers for that client)'),
  ('lost_request_email_cc',  '[]', 'CC on Lost request emails'),
  ('lost_decision_email_to', '["naveed.iqbal@shadowfax.in"]', 'Lost decisions (approved / rejected / sent back) are emailed to these addresses'),
  ('lost_decision_email_cc', '[]', 'CC on Lost decision emails (the person who asked is always copied)'),
  ('report_cc',              '[]', 'CC on the daily report'),
  ('daily_report_enabled',   'false', 'Send the daily report'),
  ('daily_report_hour',      '9', 'Hour of day (IST, 0–23) the daily report is sent'),
  ('weekly_report_enabled',  'false', 'Send the weekly Lost / pending summary'),
  ('weekly_report_day',      '1', 'Day of week for the weekly report (0 = Sunday … 6 = Saturday)'),
  ('weekly_report_hour',     '9', 'Hour of day (IST, 0–23) the weekly report is sent'),
  ('weekly_report_recipients', '["santhoshkumar.m@shadowfax.in","naveed.iqbal@shadowfax.in","binay.sharma@shadowfax.in"]', 'Weekly report recipients'),
  ('weekly_report_cc',       '[]', 'CC on the weekly report')
on conflict (key) do nothing;

-- Report schedules and recipients are for Super Admins only; Lost email routing for Admins too.
create or replace function public.app_settings_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if coalesce(new.key, old.key) ~ '^(report_|daily_report_|weekly_report_)' and not public.is_super_admin() then
    raise exception 'Only a Super Admin can change report schedules and recipients';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists app_settings_guard on public.app_settings;
create trigger app_settings_guard before insert or update or delete on public.app_settings
  for each row execute function public.app_settings_guard();

-- ---------- Weekly summary: pending, Lost requested, loss accepted ----------
create or replace function public.weekly_report_data(p_days int default 7)
returns jsonb language sql stable security invoker set search_path = public as $$
  with base as materialized (
    select id, awb, client_display_name, team_status, status_category, escalation_date, aging_days, hub, location, reason,
           team_remark, lost_approved_at, closure_date, created_at
    from public.v_cases
  ),
  since as (select now() - make_interval(days => p_days) as t, public.app_today() - p_days as d)
  select jsonb_build_object(
    'generated_at', now(),
    'period_from', (select d from since) + 1,
    'period_to', public.app_today(),
    'summary', jsonb_build_object(
      'pending', (select count(*) from base where status_category = 'open'),
      'lost_requested', (select count(*) from base where status_category = 'lost_pending'),
      'loss_accepted_total', (select count(*) from base where status_category = 'lost'),
      'loss_accepted_period', (select count(*) from base where status_category = 'lost' and lost_approved_at >= (select t from since)),
      'new_period', (select count(*) from base where escalation_date > (select d from since)),
      'closed_period', (select count(*) from base where status_category = 'closed' and closure_date > (select d from since))
    ),
    'client_wise', coalesce((select jsonb_agg(c order by c.pending + c.lost_requested desc, c.client) from (
        select coalesce(client_display_name, 'Unassigned') as client,
               count(*) filter (where status_category = 'open') as pending,
               count(*) filter (where status_category = 'lost_pending') as lost_requested,
               count(*) filter (where status_category = 'lost' and lost_approved_at >= (select t from since)) as loss_accepted_period,
               count(*) filter (where status_category = 'lost') as loss_accepted_total,
               round(avg(aging_days) filter (where status_category = 'open')::numeric, 1) as avg_pending_aging
        from base group by 1) c), '[]'::jsonb),
    'accepted_period', coalesce((select jsonb_agg(a order by a.approved_at desc) from (
        select client_display_name as client, awb, escalation_date, aging_days, coalesce(hub, location) as hub, reason,
               team_remark as final_remark, lost_approved_at as approved_at
        from base where status_category = 'lost' and lost_approved_at >= (select t from since)
        order by lost_approved_at desc, awb limit 500) a), '[]'::jsonb),
    'requested_open', coalesce((select jsonb_agg(r order by r.requested_at) from (
        select b.client_display_name as client, b.awb, b.escalation_date, b.aging_days, coalesce(b.hub, b.location) as hub,
               la.request_reason as reason, la.requested_at, la.requested_via
        from public.lost_approvals la join base b on b.id = la.case_id
        where la.status = 'pending' order by la.requested_at, b.awb limit 1000) r), '[]'::jsonb)
  )
$$;

grant execute on function public.case_stats_f(jsonb) to authenticated;
grant execute on function public.weekly_report_data(int) to authenticated, service_role;

-- Report runs remember which period they covered (prevents double sends from the hourly scheduler).
alter table public.report_runs add column if not exists period_key text;
create index if not exists report_runs_type_period_idx on public.report_runs (report_type, period_key) where status = 'sent';

-- Approvers are no longer "Admins" only.
update public.status_master set label = 'Lost — Pending Approval' where code = 'lost_pending_approval' and label = 'Lost — Pending Admin Approval';

-- ######## lost requests (LR-n) ########
-- =====================================================================
-- Lost requests as a unit: one request (LR-n) groups every AWB asked for together,
-- per client. Request-wise review, request-wise emails and notifications, client history.
-- =====================================================================

create sequence if not exists public.lost_request_seq;

create table if not exists public.lost_requests (
  id                uuid primary key default gen_random_uuid(),
  request_number    int not null default nextval('public.lost_request_seq') unique,
  client_id         uuid references public.clients (id) on delete set null,
  requested_by      uuid references public.profiles (id) on delete set null,
  requested_by_name text,          -- snapshot, so client POCs can see who asked without reading profiles
  requested_via     text not null,
  reason            text,
  txid              bigint not null default txid_current(),
  created_at        timestamptz not null default now(),
  emailed_at        timestamptz    -- request email sent (claimed) at
);
create index if not exists lost_requests_client_idx on public.lost_requests (client_id, created_at desc);
create index if not exists lost_requests_txid_idx on public.lost_requests (txid);
create index if not exists lost_requests_unemailed_idx on public.lost_requests (created_at) where emailed_at is null;

alter table public.lost_approvals add column if not exists request_id uuid references public.lost_requests (id) on delete set null;
create index if not exists lost_approvals_request_idx on public.lost_approvals (request_id, status);

alter table public.lost_requests enable row level security;
drop policy if exists lost_requests_read on public.lost_requests;
create policy lost_requests_read on public.lost_requests for select to authenticated
  using ((select public.is_internal()) or client_id in (select public.poc_client_ids()));
-- No write policies: rows are created by the trigger below only.

-- ---------- Backfill: group existing requests (same client, channel, person, minute) ----------
do $$
declare g record; v_id uuid;
begin
  for g in
    select c.client_id, la.requested_via, la.requested_by, date_trunc('minute', la.requested_at) as m,
           min(la.requested_at) as first_at, (array_agg(la.request_reason order by la.requested_at))[1] as reason
    from public.lost_approvals la join public.cases c on c.id = la.case_id
    where la.request_id is null
    group by 1, 2, 3, 4
    order by min(la.requested_at)
  loop
    insert into public.lost_requests (client_id, requested_by, requested_by_name, requested_via, reason, created_at, emailed_at, txid)
    values (g.client_id, g.requested_by,
            (select coalesce(full_name, email) from public.profiles where id = g.requested_by),
            g.requested_via, g.reason, g.first_at, now(), 0)
    returning id into v_id;
    update public.lost_approvals la set request_id = v_id
      from public.cases c
     where c.id = la.case_id and la.request_id is null
       and c.client_id is not distinct from g.client_id and la.requested_via = g.requested_via
       and la.requested_by is not distinct from g.requested_by and date_trunc('minute', la.requested_at) = g.m;
  end loop;
end $$;

-- ---------- Every new Lost approval joins the request of its transaction (per client) ----------
create or replace function public.lost_approval_assign_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
  v_agent  uuid;
  v_rid    uuid;
  v_num    int;
  v_cname  text;
  v_link   text;
begin
  select client_id, assigned_agent into v_client, v_agent from public.cases where id = new.case_id;
  if new.request_id is null then
    select id into v_rid from public.lost_requests
     where txid = txid_current() and client_id is not distinct from v_client
       and requested_via = new.requested_via and requested_by is not distinct from new.requested_by
     order by created_at desc limit 1;
    if v_rid is null then
      insert into public.lost_requests (client_id, requested_by, requested_by_name, requested_via, reason, created_at)
      values (v_client, new.requested_by, (select coalesce(full_name, email) from public.profiles where id = new.requested_by),
              new.requested_via, new.request_reason, new.requested_at)
      returning id into v_rid;
    end if;
    new.request_id := v_rid;
  end if;

  -- One notification per request for: Super Admins, Admins, this client's approvers and the case's agent.
  select r.request_number, c.name into v_num, v_cname
    from public.lost_requests r left join public.clients c on c.id = r.client_id where r.id = new.request_id;
  v_link := '/lost-approval/requests/' || new.request_id;
  insert into public.notifications (user_id, type, title, body, case_id, link)
  select p.id, 'lost_request', 'Lost request LR-' || v_num || ' from ' || coalesce(v_cname, 'unknown client'), new.request_reason, null, v_link
  from public.profiles p
  where p.is_active and p.id is distinct from new.requested_by
    and (p.role in ('super_admin', 'admin') or p.id = v_agent
         or p.id in (select a.user_id from public.lost_approver_emails(v_client) a))
    and not exists (select 1 from public.notifications n where n.user_id = p.id and n.link = v_link);
  return new;
end $$;
drop trigger if exists lost_approval_assign_request on public.lost_approvals;
create trigger lost_approval_assign_request before insert on public.lost_approvals
  for each row execute function public.lost_approval_assign_request();

-- The per-AWB "Lost approval needed" notifications are replaced by the per-request one above.
create or replace function public.notify_admins(p_type text, p_title text, p_body text, p_case uuid, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, case_id, link)
  select p.id, p_type, p_title, p_body, p_case, p_link
  from public.profiles p
  where p_type <> 'lost_request' and p.is_active and p.role in ('super_admin', 'admin')
$$;

-- ---------- Decisions: one notification per request and decision, not per AWB ----------
create or replace function public.decide_lost(p_approval_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_appr public.lost_approvals%rowtype;
  v_case public.cases%rowtype;
  v_target text;
  v_num int;
  v_link text;
  v_title text;
begin
  if p_decision not in ('approved', 'rejected', 'sent_back') then
    raise exception 'Unknown decision %', p_decision;
  end if;
  select * into v_appr from public.lost_approvals where id = p_approval_id for update;
  if not found then raise exception 'Approval request not found'; end if;
  if v_appr.status <> 'pending' then raise exception 'This request was already decided'; end if;
  select * into v_case from public.cases where id = v_appr.case_id for update;
  if not public.can_approve_lost(v_case.client_id) then
    raise exception 'NOT_APPROVER: You are not allowed to decide Lost requests for this client';
  end if;

  update public.lost_approvals
     set status = p_decision::public.approval_status, decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_approval_id;

  perform set_config('app.lost_flow', 'on', true);
  if p_decision = 'approved' then
    update public.cases
       set team_status = 'lost', lost_approved_at = now(), lost_approved_by = auth.uid(),
           closure_date = public.app_today(), last_change_source = 'app'
     where id = v_case.id;
  else
    v_target := case
      when p_decision = 'sent_back' then 'working_on_it'
      when public.status_category_of(v_appr.previous_status) in ('lost', 'lost_pending') then 'working_on_it'
      else v_appr.previous_status end;
    update public.cases
       set team_status = v_target, lost_requested_at = null, last_change_source = 'app'
     where id = v_case.id;
  end if;
  perform set_config('app.lost_flow', 'off', true);

  insert into public.case_updates (case_id, action, note, source, client_visible, user_id)
  values (v_case.id,
          case p_decision when 'approved' then 'lost_approved' when 'rejected' then 'lost_rejected' else 'lost_sent_back' end,
          nullif(trim(coalesce(p_note, '')), ''), 'app', true, auth.uid());

  if v_appr.requested_by is not null and v_appr.requested_by <> auth.uid() then
    select request_number into v_num from public.lost_requests where id = v_appr.request_id;
    v_link := case when (select role from public.profiles where id = v_appr.requested_by) = 'client_poc'
                   then '/portal/requests/' else '/lost-approval/requests/' end || coalesce(v_appr.request_id::text, '');
    v_title := 'Lost request ' || coalesce('LR-' || v_num, v_case.awb) || ': '
               || case p_decision when 'approved' then 'loss accepted' when 'rejected' then 'rejected' else 'sent back for investigation' end;
    if not exists (select 1 from public.notifications n where n.user_id = v_appr.requested_by and n.title = v_title
                     and n.read_at is null and n.created_at > now() - interval '30 minutes') then
      insert into public.notifications (user_id, type, title, body, case_id, link)
      values (v_appr.requested_by, 'lost_decision', v_title, nullif(trim(coalesce(p_note, '')), ''), null, v_link);
    end if;
  end if;
end $$;

-- ---------- Request-wise summary (internal queue and client history) ----------
drop view if exists public.v_lost_request_summary;
create view public.v_lost_request_summary with (security_invoker = true) as
with me as materialized (
  select coalesce(public.is_super_admin(), false) as is_super,
         array(select coalesce(la.client_id, '00000000-0000-0000-0000-000000000000'::uuid)
               from public.lost_approvers la join public.profiles p on p.id = la.user_id
               where la.user_id = auth.uid() and p.is_active) as scopes
),
items as (
  select la.request_id,
         count(*)::int as awb_count,
         count(*) filter (where la.status = 'pending')::int as pending,
         count(*) filter (where la.status = 'approved')::int as accepted,
         count(*) filter (where la.status = 'rejected')::int as rejected,
         count(*) filter (where la.status = 'sent_back')::int as sent_back,
         max(v.current_aging_days) as max_aging,
         round(avg(v.current_aging_days)::numeric, 1) as avg_aging,
         min(v.escalation_date) as oldest_escalation,
         max(la.decided_at) as last_decided_at,
         min(la.decided_at) filter (where la.status = 'approved') as first_accepted_at,
         max(la.decided_at) filter (where la.status = 'approved') as last_accepted_at,
         coalesce(sum(v.product_value), 0) as total_value,
         string_agg(distinct v.hub, ', ') as hubs
  from public.lost_approvals la
  join public.v_cases v on v.id = la.case_id
  where la.request_id is not null
  group by la.request_id
)
select r.id, r.request_number, r.client_id, coalesce(c.name, 'Unknown client') as client_name,
       r.requested_by, r.requested_by_name, r.requested_via, r.reason, r.created_at,
       i.awb_count, i.pending, i.accepted, i.rejected, i.sent_back, i.max_aging, i.avg_aging, i.oldest_escalation,
       i.last_decided_at, i.first_accepted_at, i.last_accepted_at, i.total_value, i.hubs,
       (public.app_today() - (r.created_at at time zone 'Asia/Kolkata')::date) as waiting_days,
       case
         when i.pending = i.awb_count then 'pending'
         when i.pending > 0 then 'partly_decided'
         when i.accepted = i.awb_count then 'accepted'
         when i.accepted > 0 then 'partly_accepted'
         when i.rejected = i.awb_count then 'rejected'
         else 'sent_back'
       end as status,
       (me.is_super or '00000000-0000-0000-0000-000000000000'::uuid = any (me.scopes) or r.client_id = any (me.scopes)) as can_decide
from public.lost_requests r
join items i on i.request_id = r.id
left join public.clients c on c.id = r.client_id
cross join me;

-- AWB-level queue gets the request reference too.
create or replace view public.v_lost_requests with (security_invoker = true) as
with me as materialized (
  select coalesce(public.is_super_admin(), false) as is_super,
         array(select coalesce(la.client_id, '00000000-0000-0000-0000-000000000000'::uuid)
               from public.lost_approvers la join public.profiles p on p.id = la.user_id
               where la.user_id = auth.uid() and p.is_active) as scopes
)
select la.id, la.case_id, la.requested_by, la.requested_via, la.requested_at, la.request_reason, la.status,
       la.decided_by, la.decided_at, la.decision_note,
       v.awb, v.client_id, v.client_display_name, v.escalation_date, v.current_aging_days, v.aging_bucket,
       v.hub, v.location, v.product_value, v.poc_name, v.agent_display_name, v.reason as case_reason,
       coalesce(rp.full_name, rp.email) as requested_by_name, rp.role as requested_by_role,
       coalesce(dp.full_name, dp.email) as decided_by_name,
       (me.is_super or '00000000-0000-0000-0000-000000000000'::uuid = any (me.scopes) or v.client_id = any (me.scopes)) as can_decide,
       la.request_id, lr.request_number
from public.lost_approvals la
join public.v_cases v on v.id = la.case_id
left join public.profiles rp on rp.id = la.requested_by
left join public.profiles dp on dp.id = la.decided_by
left join public.lost_requests lr on lr.id = la.request_id
cross join me;

-- ---------- "Loss accepted" emails: recipients managed by Super Admins ----------
insert into public.app_settings (key, value, description) values
  ('loss_accepted_email_to', '["naveed.iqbal@shadowfax.in"]', 'Every accepted loss is emailed to these addresses (one email per request)'),
  ('loss_accepted_email_cc', '[]', 'CC on loss accepted emails (the person who asked is always copied)')
on conflict (key) do nothing;
update public.app_settings set description = 'Rejected / sent back Lost requests are emailed to these addresses'
 where key = 'lost_decision_email_to';
update public.app_settings set description = 'CC on rejected / sent back emails (the person who asked is always copied)'
 where key = 'lost_decision_email_cc';

-- Claim unsent request emails atomically (service role only).
create or replace function public.claim_lost_request_emails(p_max int default 50)
returns setof public.lost_requests language sql security definer set search_path = public as $$
  update public.lost_requests set emailed_at = now()
   where id in (select id from public.lost_requests
                 where emailed_at is null and created_at > now() - interval '2 days'
                 order by created_at limit p_max for update skip locked)
  returning *
$$;
revoke execute on function public.claim_lost_request_emails(int) from public, anon, authenticated;
grant execute on function public.claim_lost_request_emails(int) to service_role;

-- ######## pending POD focus ########
-- =====================================================================
-- POD focus: "Pending POD" (open, POD not yet shared) and "Critical" (pending POD older than N days),
-- one filter function shared by the simple dashboards, and the daily critical-aging email settings.
-- =====================================================================

insert into public.app_settings (key, value, description) values
  ('critical_aging_days',        '7',     'A pending POD older than this many days is critical'),
  ('critical_alert_enabled',     'false',  'Send the daily critical-aging email'),
  ('critical_alert_hour',        '9',     'Hour of day (IST, 0–23) the critical-aging email is sent'),
  ('critical_alert_email_to',    '["naveed.iqbal@shadowfax.in"]', 'Daily critical-aging email recipients'),
  ('critical_alert_email_cc',    '[]',    'CC on the daily critical-aging email'),
  ('critical_alert_to_agents',   'true',  'Also email each agent the critical shipments assigned to them')
on conflict (key) do nothing;

create or replace function public.critical_days()
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = 'critical_aging_days'), 7)
$$;
grant execute on function public.critical_days() to authenticated, service_role;

-- Schedules and recipients of the critical email are Super Admin only.
create or replace function public.app_settings_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if coalesce(new.key, old.key) ~ '^(report_|daily_report_|weekly_report_|loss_accepted_|critical_alert_)' and not public.is_super_admin() then
    raise exception 'Only a Super Admin can change report schedules and email recipients';
  end if;
  return coalesce(new, old);
end $$;

-- Every filter the dashboards and lists use, in one place (RLS of v_cases still applies).
-- Extra categories: pending_pod, critical. Extra keys: agemin, agemax (days).
create or replace function public.cases_filtered(p jsonb default '{}'::jsonb)
returns setof public.v_cases language sql stable security invoker set search_path = public as $$
  select v.* from public.v_cases v
  where (nullif(p ->> 'client', '') is null
         or (p ->> 'client' = 'none' and v.client_id is null)
         or v.client_id::text = p ->> 'client')
    and (nullif(p ->> 'source', '') is null or v.source_type::text = p ->> 'source')
    and (nullif(p ->> 'from', '') is null or v.escalation_date >= (p ->> 'from')::date)
    and (nullif(p ->> 'to', '') is null or v.escalation_date <= (p ->> 'to')::date)
    and (nullif(p ->> 'hub', '') is null or v.hub ilike '%' || (p ->> 'hub') || '%' or v.location ilike '%' || (p ->> 'hub') || '%')
    and (nullif(p ->> 'agent', '') is null
         or (p ->> 'agent' = 'unassigned' and v.assigned_agent is null)
         or v.assigned_agent::text = p ->> 'agent')
    and (nullif(p ->> 'poc', '') is null or v.client_poc_id::text = p ->> 'poc')
    and (nullif(p ->> 'status', '') is null or v.team_status = p ->> 'status')
    and (nullif(p ->> 'category', '') is null or p ->> 'category' = 'all'
         or (p ->> 'category' = 'active' and v.status_category in ('open', 'lost_pending'))
         or (p ->> 'category' in ('pending_pod', 'critical') and v.status_category = 'open'
             and v.team_status <> 'pod_shared' and v.pod_status <> 'shared'
             and (p ->> 'category' = 'pending_pod' or v.aging_days > public.critical_days()))
         or v.status_category::text = p ->> 'category')
    and (nullif(p ->> 'aging', '') is null or v.aging_bucket = p ->> 'aging')
    and (nullif(p ->> 'agemin', '') is null or v.aging_days >= (p ->> 'agemin')::int)
    and (nullif(p ->> 'agemax', '') is null or v.aging_days <= (p ->> 'agemax')::int)
    and (coalesce(p ->> 'sla', '') <> '1' or v.sla_breached)
    and (nullif(p ->> 'reason', '') is null or v.reason ilike '%' || (p ->> 'reason') || '%')
    and (nullif(p ->> 'q', '') is null
         or (cardinality(public.split_awbs(p ->> 'q')) > 1 and v.awb = any (public.split_awbs(p ->> 'q')))
         or (cardinality(public.split_awbs(p ->> 'q')) <= 1 and (
               v.awb ilike '%' || (p ->> 'q') || '%' or v.client_display_name ilike '%' || (p ->> 'q') || '%'
               or v.email_subject ilike '%' || (p ->> 'q') || '%' or v.hub ilike '%' || (p ->> 'q') || '%'
               or v.location ilike '%' || (p ->> 'q') || '%' or v.poc_name ilike '%' || (p ->> 'q') || '%'
               or v.agent_display_name ilike '%' || (p ->> 'q') || '%' or v.seller_name ilike '%' || (p ->> 'q') || '%'
               or v.order_id ilike '%' || (p ->> 'q') || '%')))
$$;
grant execute on function public.cases_filtered(jsonb) to authenticated, service_role;

-- The simple dashboards: where every shipment stands on the way to "POD shared" or "Loss accepted".
create or replace function public.pod_stats(p jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path = public as $$
  with base as materialized (
    select client_id, coalesce(client_display_name, 'No client') as client, assigned_agent,
           coalesce(agent_display_name, 'Unassigned') as agent, team_status, status_category, pod_status, aging_days, escalation_date,
           (status_category = 'open' and team_status <> 'pod_shared' and pod_status <> 'shared') as pending
    from public.cases_filtered(p - 'category' - 'status' - 'agemin' - 'agemax' - 'aging')
  ),
  k as (select public.critical_days() as d, public.app_today() as today),
  -- Age columns of the pivot tables (pending POD only):
  --   d7 = day by day for the first week (column 1 includes cases escalated today), b = 0–10 … 90+ days.
  d7 as (select n, case when n = 1 then 0 else n end as lo, n as hi, n::text as label from generate_series(1, 7) n),
  b as (select * from (values (1, '0–10', 0, 10), (2, '11–20', 11, 20), (3, '21–30', 21, 30),
                               (4, '31–60', 31, 60), (5, '61–90', 61, 90), (6, '90+', 91, null)) as bb(n, label, lo, hi)),
  pb as materialized (   -- pending POD with its 0–10 … 90+ column
    select base.*, b.n from base join b on base.aging_days between b.lo and coalesce(b.hi, 100000) where base.pending
  ),
  p7 as materialized (   -- pending POD of the first week with its day column
    select base.*, d7.n from base join d7 on base.aging_days between d7.lo and d7.hi where base.pending
  )
  select jsonb_build_object(
    'critical_days', (select d from k),
    'total', (select count(*) from base),
    'pending', (select count(*) from base where pending),
    'critical', (select count(*) from base, k where pending and aging_days > k.d),
    'pod_shared', (select count(*) from base where status_category = 'open' and not pending),
    'closed', (select count(*) from base where status_category = 'closed'),
    'lost_pending', (select count(*) from base where status_category = 'lost_pending'),
    'lost', (select count(*) from base where status_category = 'lost'),
    'new_today', (select count(*) from base, k where escalation_date >= k.today - 1),
    'pending_age', (select jsonb_agg(jsonb_build_object('label', b.label, 'min', b.lo, 'max', b.hi,
                                                        'count', (select count(*) from pb where pb.n = b.n)) order by b.n) from b),
    'week_days', (select jsonb_agg(jsonb_build_object('label', d7.label, 'min', d7.lo, 'max', d7.hi,
                                                      'count', (select count(*) from p7 where p7.n = d7.n)) order by d7.n) from d7),
    'by_client', coalesce((select jsonb_agg(c order by c.pending desc, c.total desc, c.client) from (
        select client_id, client,
               count(*) as total,
               count(*) filter (where pending) as pending,
               count(*) filter (where pending and aging_days > (select d from k)) as critical,
               count(*) filter (where (status_category = 'open' and not pending) or status_category = 'closed') as pod_shared,
               count(*) filter (where status_category = 'lost_pending') as lost_pending,
               count(*) filter (where status_category = 'lost') as lost,
               max(aging_days) filter (where pending) as oldest,
               (select jsonb_agg((select count(*) from pb where pb.n = b.n and pb.client_id is not distinct from base.client_id) order by b.n) from b) as age,
               (select jsonb_agg((select count(*) from p7 where p7.n = d7.n and p7.client_id is not distinct from base.client_id) order by d7.n) from d7) as week
        from base group by client_id, client) c), '[]'::jsonb),
    'by_agent', coalesce((select jsonb_agg(g order by g.pending desc, g.agent) from (
        select assigned_agent as agent_id, agent,
               count(*) as pending,
               count(*) filter (where aging_days > (select d from k)) as critical,
               max(aging_days) as oldest,
               (select jsonb_agg((select count(*) from pb x where x.n = b.n and x.assigned_agent is not distinct from pb.assigned_agent) order by b.n) from b) as age
        from pb group by assigned_agent, agent) g), '[]'::jsonb)
  )
$$;
grant execute on function public.pod_stats(jsonb) to authenticated, service_role;

-- ######## adding pending cases ########
-- =====================================================================
-- Adding pending cases by hand or from the fixed-format Excel, for the team and for client POCs.
-- =====================================================================

create table if not exists public.case_uploads (
  id            uuid primary key default gen_random_uuid(),
  uploaded_by   uuid references public.profiles (id) on delete set null,
  uploader_name text,
  client_id     uuid references public.clients (id) on delete set null,
  method        text not null default 'excel' check (method in ('excel', 'manual')),
  filename      text,
  total_rows    int not null default 0,
  created       int not null default 0,
  skipped       int not null default 0,
  problems      jsonb not null default '[]'::jsonb,   -- [{row, awb, message}]
  drive_url     text,
  drive_error   text,
  created_at    timestamptz not null default now()
);
create index if not exists case_uploads_created_idx on public.case_uploads (created_at desc);
alter table public.case_uploads enable row level security;
drop policy if exists case_uploads_read on public.case_uploads;
create policy case_uploads_read on public.case_uploads for select to authenticated
  using ((select public.is_internal()) or client_id in (select public.poc_client_ids()));
-- Written by the server (service role) after the rows were created through create_pending_cases().

/**
 * Creates pending cases. Internal users: any client (per row "client_id" or p_client_id), may force duplicates.
 * Client POCs: only their own client, never duplicates of shipments still being worked on.
 * Rows: [{awb, escalation_date, client_id?, hub, location, delivery_date, seller_name, order_id, product_name,
 *         product_value, complaint_type, reason, priority, remark}]
 */
create or replace function public.create_pending_cases(p_client_id uuid, p_rows jsonb, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role := public.app_role();
  v_poc boolean;
  v_poc_id uuid;
  r jsonb;
  v_client uuid;
  v_awb text;
  v_esc date;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_n int := 0;
begin
  if v_role is null then raise exception 'Not signed in or account inactive'; end if;
  v_poc := v_role = 'client_poc';
  if v_poc then
    if p_client_id is null or p_client_id not in (select public.poc_client_ids()) then raise exception 'Choose your client'; end if;
    select id into v_poc_id from public.client_pocs where user_id = auth.uid() and client_id = p_client_id order by is_active desc limit 1;
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 5000 then raise exception 'At most 5,000 rows at a time'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_n := v_n + 1;
    v_awb := upper(regexp_replace(coalesce(r ->> 'awb', ''), '\s', '', 'g'));
    v_client := case when v_poc then p_client_id else coalesce(nullif(r ->> 'client_id', '')::uuid, p_client_id) end;
    begin
      v_esc := (r ->> 'escalation_date')::date;
    exception when others then v_esc := null; end;
    if v_awb = '' or v_awb !~ '[A-Z0-9]{6,}' then
      v_skipped := v_skipped || jsonb_build_object('row', coalesce((r ->> 'row')::int, v_n), 'awb', v_awb, 'message', 'AWB missing or invalid');
      continue;
    end if;
    if v_esc is null or v_esc > public.app_today() or v_esc < date '2020-01-01' then
      v_skipped := v_skipped || jsonb_build_object('row', coalesce((r ->> 'row')::int, v_n), 'awb', v_awb, 'message', 'Escalation date missing, in the future or before 2020');
      continue;
    end if;
    if v_client is null then
      v_skipped := v_skipped || jsonb_build_object('row', coalesce((r ->> 'row')::int, v_n), 'awb', v_awb, 'message', 'Client missing');
      continue;
    end if;
    if (v_poc or not coalesce(p_force, false)) and exists (
         select 1 from public.cases c join public.status_master s on s.code = c.team_status
         where c.awb = v_awb and not c.is_deleted and s.category in ('open', 'lost_pending')) then
      v_skipped := v_skipped || jsonb_build_object('row', coalesce((r ->> 'row')::int, v_n), 'awb', v_awb, 'message', 'Already open — being worked on');
      continue;
    end if;
    insert into public.cases (awb, client_id, client_poc_id, escalation_date, hub, location, delivery_date, seller_name, order_id,
                              product_name, product_value, complaint_type, reason, priority, team_remark, client_remark,
                              source_type, team_status, status_source, created_by, last_change_source, assigned_agent)
    values (v_awb, v_client, v_poc_id, v_esc, nullif(r ->> 'hub', ''), nullif(r ->> 'location', ''),
            (case when coalesce(r ->> 'delivery_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (r ->> 'delivery_date')::date end),
            nullif(r ->> 'seller_name', ''), nullif(r ->> 'order_id', ''), nullif(r ->> 'product_name', ''),
            (case when coalesce(r ->> 'product_value', '') ~ '^\d+(\.\d+)?$' then (r ->> 'product_value')::numeric end),
            nullif(r ->> 'complaint_type', ''), nullif(r ->> 'reason', ''), nullif(r ->> 'priority', ''),
            case when v_poc then null else nullif(r ->> 'remark', '') end,
            case when v_poc then nullif(r ->> 'remark', '') end,
            'manual', 'pending', 'app', auth.uid(), case when v_poc then 'poc' else 'app' end,
            case when not v_poc then nullif(r ->> 'assigned_agent', '')::uuid end)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  if cardinality(v_ids) > 0 then
    perform public.notify_admins('new_cases',
      cardinality(v_ids) || ' new pending case' || case when cardinality(v_ids) = 1 then '' else 's' end || ' added' ||
        case when v_poc then ' by ' || coalesce((select name from public.clients where id = p_client_id), 'a client') else '' end,
      null, null, '/cases?category=pending_pod&sort=updated_at&dir=desc');
  end if;
  return jsonb_build_object('created', cardinality(v_ids), 'case_ids', to_jsonb(v_ids), 'skipped', v_skipped);
end $$;
revoke execute on function public.create_pending_cases(uuid, jsonb, boolean) from public, anon;
grant execute on function public.create_pending_cases(uuid, jsonb, boolean) to authenticated;

-- ######## sidebar badges in one call ########
create or replace function public.sidebar_counts()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'unread', (select count(*) from public.notifications where user_id = auth.uid() and read_at is null),
    'emails', (select count(*) from public.emails where status = 'needs_review'),
    'lost_requests', (select count(distinct coalesce(request_id, id)) from public.lost_approvals where status = 'pending'))
$$;
grant execute on function public.sidebar_counts() to authenticated;

-- ######## tidy-up ########
delete from public.app_settings where key = 'sheet_lost_email';
update public.app_settings set description = 'Send emails automatically (new Lost requests and Lost decisions). Off = no automatic emails.'
 where key = 'notify_admins_by_email';
-- One time only (Oct 2026): switch every automatic email off; a Super Admin can turn them back on in Settings.
do $$ begin
  if not exists (select 1 from public.app_settings where key = 'emails_reset_2026_10') then
    update public.app_settings set value = 'false'
     where key in ('notify_admins_by_email', 'daily_report_enabled', 'weekly_report_enabled', 'critical_alert_enabled');
    insert into public.app_settings (key, value, description)
    values ('emails_reset_2026_10', 'true', 'Marker: automatic emails were switched off once by the Oct 2026 clean-up');
  end if;
end $$;
