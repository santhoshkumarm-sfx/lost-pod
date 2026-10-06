-- =====================================================================
-- Helpers, triggers, workflow functions, analytics
-- =====================================================================

-- ---------- Settings / time ----------
create or replace function public.app_setting(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = p_key
$$;

create or replace function public.app_setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = p_key), p_default)
$$;

-- "Today" in the operating timezone (default Asia/Kolkata). Aging is always computed from this.
create or replace function public.app_today()
returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce(
    (select value #>> '{}' from public.app_settings where key = 'timezone'), 'Asia/Kolkata'))::date
$$;

-- ---------- Role helpers (security definer so policies never recurse into profiles RLS) ----------
create or replace function public.app_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_internal()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('super_admin', 'admin', 'internal_team'), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('super_admin', 'admin'), false)
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'super_admin', false)
$$;

-- Clients the signed-in POC may see. Empty for everyone else.
create or replace function public.poc_client_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select cp.client_id
  from public.client_pocs cp
  join public.profiles p on p.id = cp.user_id
  where cp.user_id = auth.uid() and cp.is_active and p.is_active and p.role = 'client_poc'
$$;

create or replace function public.status_category_of(p_code text)
returns public.status_category language sql stable security definer set search_path = public as $$
  select category from public.status_master where code = p_code
$$;

-- ---------- New auth user -> profile ----------
-- Role comes from app_metadata, which only the service role can set. Self sign-ups land inactive.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role;
begin
  begin
    v_role := (new.raw_app_meta_data ->> 'role')::public.user_role;
  exception when others then
    v_role := null;
  end;
  insert into public.profiles (id, email, full_name, role, is_active)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
          coalesce(v_role, 'client_poc'), v_role is not null)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- updated_at ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger client_pocs_touch before update on public.client_pocs for each row execute function public.touch_updated_at();
create trigger sheet_sources_touch before update on public.sheet_sources for each row execute function public.touch_updated_at();
create trigger emails_touch before update on public.emails for each row execute function public.touch_updated_at();

-- ---------- Case guard: Lost workflow + closure / aging bookkeeping ----------
create or replace function public.cases_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lost_flow boolean := coalesce(current_setting('app.lost_flow', true), '') = 'on';
  v_new_cat public.status_category;
  v_old_cat public.status_category;
  v_status_changed boolean;
begin
  v_new_cat := public.status_category_of(new.team_status);
  if v_new_cat is null then
    raise exception 'Unknown status "%"', new.team_status;
  end if;
  if tg_op = 'UPDATE' then
    v_old_cat := public.status_category_of(old.team_status);
    v_status_changed := old.team_status is distinct from new.team_status;
  else
    v_status_changed := true;
  end if;

  -- Nobody can set or leave a Lost state outside the approval workflow functions.
  if not v_lost_flow and v_status_changed then
    if v_new_cat in ('lost', 'lost_pending') then
      raise exception 'LOST_WORKFLOW: Lost can only be set through a Lost request and Admin approval.';
    end if;
    if tg_op = 'UPDATE' and v_old_cat in ('lost', 'lost_pending') then
      raise exception 'LOST_WORKFLOW: This case is in the Lost workflow. Use the approval actions to change its status.';
    end if;
  end if;

  if (tg_op = 'INSERT' or new.escalation_date is distinct from old.escalation_date)
     and new.escalation_date > public.app_today() then
    raise exception 'Escalation date % is in the future', new.escalation_date;
  end if;

  new.awb := upper(regexp_replace(new.awb, '\s', '', 'g'));
  if auth.uid() is not null then
    new.last_changed_by := auth.uid();
  end if;
  new.updated_at := now();

  if v_status_changed then
    new.status_changed_at := now();
    if new.team_status = 'pod_shared' and new.pod_status <> 'shared' then
      new.pod_status := 'shared';
    end if;
    if v_new_cat in ('closed', 'lost') and (tg_op = 'INSERT' or v_old_cat not in ('closed', 'lost')) then
      new.closure_date := coalesce(new.closure_date, public.app_today());
    elsif v_new_cat in ('open', 'lost_pending') and tg_op = 'UPDATE' and v_old_cat in ('closed', 'lost') then
      new.closure_date := null;   -- reopened
    end if;
  end if;

  -- Final aging is frozen at closure and always measured from the ORIGINAL escalation date.
  if v_new_cat in ('closed', 'lost') and new.closure_date is not null then
    new.final_aging_days := greatest(new.closure_date - new.escalation_date, 0);
  else
    new.final_aging_days := null;
  end if;
  return new;
end $$;

create trigger cases_before_write
  before insert or update on public.cases
  for each row execute function public.cases_before_write();

-- ---------- Case history (never overwritten) ----------
create or replace function public.cases_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := coalesce(auth.uid(), new.last_changed_by);
  v_src text := coalesce(new.last_change_source, 'app');
  v_old jsonb;
  v_new jsonb;
  k text;
  v_fields text[] := array['team_status', 'pod_status', 'pod_link', 'team_remark', 'client_remark', 'assigned_agent',
    'assigned_agent_name', 'hub', 'location', 'priority', 'reason', 'complaint_type', 'escalation_date', 'delivery_date',
    'client_id', 'client_poc_id', 'closure_date', 'product_name', 'product_value', 'seller_name', 'shipment_status', 'awb',
    'is_deleted'];
  v_client_visible text[] := array['team_status', 'pod_status', 'pod_link', 'team_remark', 'client_remark', 'closure_date'];
begin
  if tg_op = 'INSERT' then
    insert into public.case_updates (case_id, action, new_value, note, source, client_visible, user_id)
    values (new.id, 'created', new.team_status,
            'Case created from ' || case new.source_type when 'google_sheet' then 'Google Sheet' when 'email' then 'email' else 'manual entry' end,
            v_src, true, v_user);
    return null;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach k in array v_fields loop
    if v_old -> k is distinct from v_new -> k then
      insert into public.case_updates (case_id, action, field, old_value, new_value, source, client_visible, user_id)
      values (new.id, case when k = 'team_status' then 'status_changed' else 'field_updated' end,
              k, v_old ->> k, v_new ->> k, v_src, k = any (v_client_visible), v_user);
    end if;
  end loop;
  return null;
end $$;

create trigger cases_after_write
  after insert or update on public.cases
  for each row execute function public.cases_after_write();

-- ---------- Generic audit ----------
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_logs (table_name, record_id, action, old_data, new_data, user_id)
  values (tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'key', v_row ->> 'code', v_row ->> 'case_id'), lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid());
  return null;
end $$;

create trigger audit_clients        after insert or update or delete on public.clients        for each row execute function public.audit_row();
create trigger audit_profiles       after insert or update or delete on public.profiles       for each row execute function public.audit_row();
create trigger audit_client_pocs    after insert or update or delete on public.client_pocs    for each row execute function public.audit_row();
create trigger audit_status_master  after insert or update or delete on public.status_master  for each row execute function public.audit_row();
create trigger audit_status_maps    after insert or update or delete on public.status_mappings for each row execute function public.audit_row();
create trigger audit_aging_buckets  after insert or update or delete on public.aging_buckets  for each row execute function public.audit_row();
create trigger audit_column_aliases after insert or update or delete on public.column_aliases for each row execute function public.audit_row();
create trigger audit_sheet_sources  after insert or update or delete on public.sheet_sources  for each row execute function public.audit_row();
create trigger audit_app_settings   after insert or update or delete on public.app_settings   for each row execute function public.audit_row();
create trigger audit_lost_approvals after insert or update or delete on public.lost_approvals for each row execute function public.audit_row();
create trigger audit_case_private   after insert or update or delete on public.case_private   for each row execute function public.audit_row();

-- ---------- Consolidated case view (aging computed at read time, never stored from sheets) ----------
create or replace view public.v_cases with (security_invoker = true) as
select
  c.*,
  coalesce(cl.name, c.client_name)            as client_display_name,
  cl.sla_days                                  as client_sla_days,
  ag.full_name                                 as agent_name,
  coalesce(ag.full_name, c.assigned_agent_name) as agent_display_name,
  poc.name                                     as poc_name,
  sm.label                                     as status_label,
  sm.category                                  as status_category,
  sm.color                                     as status_color,
  a.current_aging_days,
  a.aging_days,
  b.label                                      as aging_bucket,
  b.sort_order                                 as aging_bucket_order,
  (sm.category in ('open', 'lost_pending')
     and a.current_aging_days > coalesce(cl.sla_days, public.app_setting_int('default_sla_days', 7))) as sla_breached
from public.cases c
join public.status_master sm on sm.code = c.team_status
left join public.clients cl on cl.id = c.client_id
left join public.profiles ag on ag.id = c.assigned_agent
left join public.client_pocs poc on poc.id = c.client_poc_id
cross join lateral (
  select greatest(public.app_today() - c.escalation_date, 0) as current_aging_days,
         case when sm.category in ('closed', 'lost') and c.final_aging_days is not null
              then c.final_aging_days
              else greatest(public.app_today() - c.escalation_date, 0) end as aging_days
) a
left join lateral (
  select ab.label, ab.sort_order from public.aging_buckets ab
  where a.aging_days >= ab.min_days and (ab.max_days is null or a.aging_days <= ab.max_days)
  order by ab.sort_order limit 1
) b on true
where not c.is_deleted;

-- ---------- Notifications ----------
create or replace function public.notify_admins(p_type text, p_title text, p_body text, p_case uuid, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, case_id, link)
  select id, p_type, p_title, p_body, p_case, p_link
  from public.profiles where is_active and role in ('super_admin', 'admin')
$$;

-- ---------- Lost workflow ----------
-- POC (own client only) or internal team requests Lost. Never sets the final Lost status.
create or replace function public.request_lost(p_case_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role := public.app_role();
  v_case public.cases%rowtype;
  v_cat public.status_category;
  v_approval uuid;
begin
  if v_role is null then
    raise exception 'Not signed in or account inactive';
  end if;
  select * into v_case from public.cases where id = p_case_id and not is_deleted for update;
  if not found then
    raise exception 'Case not found';
  end if;
  if v_role = 'client_poc' and (v_case.client_id is null or v_case.client_id not in (select public.poc_client_ids())) then
    raise exception 'Case not found';   -- do not reveal other clients' cases
  end if;
  v_cat := public.status_category_of(v_case.team_status);
  if v_cat = 'lost' then raise exception 'This case is already Lost'; end if;
  if v_cat = 'lost_pending' then raise exception 'A Lost request is already waiting for Admin approval'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the Lost request'; end if;

  insert into public.lost_approvals (case_id, requested_by, requested_via, request_reason, previous_status)
  values (p_case_id, auth.uid(), case when v_role = 'client_poc' then 'poc_portal' else 'app' end, trim(p_reason), v_case.team_status)
  returning id into v_approval;

  insert into public.case_updates (case_id, action, note, source, client_visible, user_id)
  values (p_case_id, 'lost_requested', trim(p_reason), case when v_role = 'client_poc' then 'poc' else 'app' end, true, auth.uid());

  perform set_config('app.lost_flow', 'on', true);
  update public.cases
     set team_status = 'lost_pending_approval', lost_requested_at = now(),
         last_change_source = case when v_role = 'client_poc' then 'poc' else 'app' end
   where id = p_case_id;
  perform set_config('app.lost_flow', 'off', true);

  perform public.notify_admins('lost_request', 'Lost approval needed: ' || v_case.awb,
    coalesce((select name from public.clients where id = v_case.client_id), v_case.client_name, 'Unknown client') || ' — ' || trim(p_reason),
    p_case_id, '/lost-approval');
  return v_approval;
end $$;

-- Admin decision. Only an approval sets the final Lost status.
create or replace function public.decide_lost(p_approval_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_appr public.lost_approvals%rowtype;
  v_case public.cases%rowtype;
  v_target text;
begin
  if not public.is_admin() then
    raise exception 'Only an Admin can decide Lost requests';
  end if;
  if p_decision not in ('approved', 'rejected', 'sent_back') then
    raise exception 'Unknown decision %', p_decision;
  end if;
  select * into v_appr from public.lost_approvals where id = p_approval_id for update;
  if not found then raise exception 'Approval request not found'; end if;
  if v_appr.status <> 'pending' then raise exception 'This request was already decided'; end if;
  select * into v_case from public.cases where id = v_appr.case_id for update;

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
    insert into public.notifications (user_id, type, title, body, case_id, link)
    values (v_appr.requested_by, 'lost_decision',
            'Lost request ' || case p_decision when 'approved' then 'approved' when 'rejected' then 'rejected' else 'sent back for investigation' end || ': ' || v_case.awb,
            nullif(trim(coalesce(p_note, '')), ''), v_case.id, null);
  end if;
end $$;

create or replace function public.decide_lost_bulk(p_approval_ids uuid[], p_decision text, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_n int := 0;
begin
  if not public.is_admin() then raise exception 'Only an Admin can decide Lost requests'; end if;
  foreach v_id in array p_approval_ids loop
    perform public.decide_lost(v_id, p_decision, p_note);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Admin-only escape hatch to take a case out of Lost (e.g. shipment found). Fully audited.
create or replace function public.reopen_lost_case(p_case_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an Admin can reopen a Lost case'; end if;
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

-- ---------- Google Sheets import (service role only) ----------
-- Rows arrive already normalised by the app (header mapping, dates, AWB clean-up, status resolution).
-- This function owns the upsert/dedupe rules so they run in one transaction per batch.
create or replace function public.import_sheet_rows(p_source_id uuid, p_rows jsonb, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_src public.sheet_sources%rowtype;
  r jsonb;
  v_sr public.source_records%rowtype;
  v_case public.cases%rowtype;
  v_case_id uuid;
  v_found boolean;
  v_linked boolean;
  v_window int := public.app_setting_int('dedupe_window_days', 30);
  v_client uuid;
  v_poc uuid;
  v_agent uuid;
  v_status text;
  v_cat public.status_category;
  v_esc date;
  v_est boolean;
  v_lost_signal boolean;
  c_created int := 0; c_updated int := 0; c_linked int := 0; c_unchanged int := 0; c_skipped int := 0; c_lost int := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  select * into v_src from public.sheet_sources where id = p_source_id;
  if not found then raise exception 'Unknown sheet source %', p_source_id; end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    begin
      v_client := nullif(r ->> 'client_id', '')::uuid;
      v_esc := nullif(r ->> 'escalation_date', '')::date;
      v_est := coalesce((r ->> 'escalation_date_estimated')::boolean, false);
      v_status := coalesce(nullif(r ->> 'status_code', ''), 'pending');
      v_lost_signal := public.status_category_of(v_status) in ('lost', 'lost_pending');
      if v_lost_signal then v_status := 'lost_pending_approval'; end if;
      v_case_id := null;
      v_linked := false;

      select * into v_sr from public.source_records
       where source_type = 'google_sheet' and source_key = r ->> 'source_key';
      v_found := found;
      if v_found and v_sr.case_id is not null and v_sr.record_hash = r ->> 'record_hash' then
        update public.source_records set last_seen_at = now(), row_number = (r ->> 'row_number')::int where id = v_sr.id;
        c_unchanged := c_unchanged + 1;
        continue;
      end if;
      if v_found then v_case_id := v_sr.case_id; end if;

      -- POC named in the tracker -> client_pocs (created as a contact without login if new)
      v_poc := null;
      if v_client is not null and nullif(trim(r ->> 'poc_name'), '') is not null then
        select id into v_poc from public.client_pocs
         where client_id = v_client and lower(name) = lower(trim(r ->> 'poc_name'));
        if v_poc is null then
          insert into public.client_pocs (client_id, name) values (v_client, trim(r ->> 'poc_name'))
          on conflict do nothing returning id into v_poc;
          if v_poc is null then
            select id into v_poc from public.client_pocs
             where client_id = v_client and lower(name) = lower(trim(r ->> 'poc_name'));
          end if;
        end if;
      end if;

      -- Agent named in the tracker -> internal user (full name or first name)
      v_agent := null;
      if nullif(trim(r ->> 'agent_name'), '') is not null then
        select id into v_agent from public.profiles
         where is_active and role in ('super_admin', 'admin', 'internal_team')
           and (lower(full_name) = lower(trim(r ->> 'agent_name'))
                or lower(split_part(full_name, ' ', 1)) = lower(trim(r ->> 'agent_name')))
         order by (lower(full_name) = lower(trim(r ->> 'agent_name'))) desc
         limit 1;
      end if;

      -- Enrichment tabs (e.g. "Rough sheet" with price / POD links) only fill gaps on existing cases.
      if v_src.mode = 'enrich' then
        if v_case_id is null then
          select id into v_case_id from public.cases where awb = r ->> 'awb' and not is_deleted
           order by created_at desc limit 1;
        end if;
        if v_case_id is null then
          c_skipped := c_skipped + 1;
          continue;
        end if;
        update public.cases set
          product_value   = coalesce(product_value, nullif(r ->> 'product_value', '')::numeric),
          product_name    = coalesce(product_name, nullif(r ->> 'product_name', '')),
          delivery_date   = coalesce(delivery_date, nullif(r ->> 'delivery_date', '')::date),
          hub             = coalesce(hub, nullif(r ->> 'hub', '')),
          location        = coalesce(location, nullif(r ->> 'location', '')),
          seller_name     = coalesce(seller_name, nullif(r ->> 'seller_name', '')),
          pod_link        = coalesce(pod_link, nullif(r ->> 'pod_link', '')),
          shipment_status = coalesce(shipment_status, nullif(r ->> 'shipment_status', '')),
          order_id        = coalesce(order_id, nullif(r ->> 'order_id', '')),
          last_change_source = 'sheet', last_changed_by = p_actor
        where id = v_case_id;
        c_updated := c_updated + 1;
      else
        -- Cross-source consolidation: same AWB, same (or unknown) client, escalation within the window.
        if v_case_id is null then
          select id into v_case_id from public.cases
           where awb = r ->> 'awb' and not is_deleted
             and (client_id is null or v_client is null or client_id = v_client)
             and ((v_esc is not null and abs(escalation_date - v_esc) <= v_window)
                  or (escalation_date_estimated and sheet_source_id = p_source_id))
           order by abs(escalation_date - coalesce(v_esc, escalation_date)), created_at desc
           limit 1;
          v_linked := v_case_id is not null;
        end if;

        if v_case_id is null then
          if v_lost_signal then perform set_config('app.lost_flow', 'on', true); end if;
          insert into public.cases (
            awb, client_id, client_name, client_poc_id, escalation_date, escalation_date_estimated,
            location, hub, delivery_date, seller_name, complaint_type, reason, priority, shipment_status,
            pod_status, pod_link, product_name, product_value, order_id, rider_name, rider_id,
            source_type, source_workbook, source_sheet, source_row, sheet_source_id, email_subject,
            team_status, status_source, team_remark, client_remark, assigned_agent, assigned_agent_name,
            closure_date, lost_requested_at, extra, created_by, last_changed_by, last_change_source)
          values (
            r ->> 'awb', v_client, nullif(r ->> 'client_name', ''), v_poc, coalesce(v_esc, public.app_today()), v_est or v_esc is null,
            nullif(r ->> 'location', ''), nullif(r ->> 'hub', ''), nullif(r ->> 'delivery_date', '')::date,
            nullif(r ->> 'seller_name', ''), nullif(r ->> 'complaint_type', ''), nullif(r ->> 'reason', ''),
            nullif(r ->> 'priority', ''), nullif(r ->> 'shipment_status', ''),
            case when r ->> 'pod_status' = 'shared' then 'shared' else 'pending' end,
            nullif(r ->> 'pod_link', ''), nullif(r ->> 'product_name', ''), nullif(r ->> 'product_value', '')::numeric,
            nullif(r ->> 'order_id', ''), nullif(r ->> 'rider_name', ''), nullif(r ->> 'rider_id', ''),
            'google_sheet', coalesce(v_src.workbook_name, v_src.workbook_id), v_src.sheet_name, (r ->> 'row_number')::int,
            p_source_id, nullif(r ->> 'email_subject', ''),
            v_status, 'import', nullif(r ->> 'team_remark', ''), nullif(r ->> 'client_remark', ''), v_agent,
            nullif(trim(r ->> 'agent_name'), ''),
            case when public.status_category_of(v_status) = 'closed' then nullif(r ->> 'closure_date', '')::date end,
            case when v_lost_signal then now() end,
            coalesce(r -> 'extra', '{}'::jsonb), p_actor, p_actor, 'sheet')
          returning id into v_case_id;
          perform set_config('app.lost_flow', 'off', true);

          if v_lost_signal then
            insert into public.lost_approvals (case_id, requested_by, requested_via, request_reason, previous_status)
            values (v_case_id, p_actor, 'google_sheet',
                    coalesce(nullif(r ->> 'status_raw', ''), 'Marked Lost in tracker') || ' (' || v_src.sheet_name || ')', 'pending');
            insert into public.case_updates (case_id, action, note, source, client_visible, user_id)
            values (v_case_id, 'lost_requested', 'Marked Lost in Google Sheet "' || v_src.sheet_name || '" — waiting for Admin approval', 'sheet', true, p_actor);
            c_lost := c_lost + 1;
          end if;
          c_created := c_created + 1;
        else
          select * into v_case from public.cases where id = v_case_id;
          v_cat := public.status_category_of(v_case.team_status);
          if v_linked then
            -- Another source already owns this case: only fill gaps.
            update public.cases set
              client_id       = coalesce(client_id, v_client),
              client_poc_id   = coalesce(client_poc_id, v_poc),
              escalation_date = case when escalation_date_estimated and v_esc is not null and not v_est then v_esc else escalation_date end,
              escalation_date_estimated = escalation_date_estimated and (v_est or v_esc is null),
              location        = coalesce(location, nullif(r ->> 'location', '')),
              hub             = coalesce(hub, nullif(r ->> 'hub', '')),
              delivery_date   = coalesce(delivery_date, nullif(r ->> 'delivery_date', '')::date),
              seller_name     = coalesce(seller_name, nullif(r ->> 'seller_name', '')),
              complaint_type  = coalesce(complaint_type, nullif(r ->> 'complaint_type', '')),
              reason          = coalesce(reason, nullif(r ->> 'reason', '')),
              priority        = coalesce(priority, nullif(r ->> 'priority', '')),
              shipment_status = coalesce(shipment_status, nullif(r ->> 'shipment_status', '')),
              pod_link        = coalesce(pod_link, nullif(r ->> 'pod_link', '')),
              product_name    = coalesce(product_name, nullif(r ->> 'product_name', '')),
              product_value   = coalesce(product_value, nullif(r ->> 'product_value', '')::numeric),
              order_id        = coalesce(order_id, nullif(r ->> 'order_id', '')),
              email_subject   = coalesce(email_subject, nullif(r ->> 'email_subject', '')),
              team_remark     = coalesce(team_remark, nullif(r ->> 'team_remark', '')),
              client_remark   = coalesce(client_remark, nullif(r ->> 'client_remark', '')),
              assigned_agent  = coalesce(assigned_agent, v_agent),
              assigned_agent_name = coalesce(assigned_agent_name, nullif(trim(r ->> 'agent_name'), '')),
              sheet_source_id = coalesce(sheet_source_id, p_source_id),
              source_workbook = coalesce(source_workbook, v_src.workbook_name, v_src.workbook_id),
              source_sheet    = coalesce(source_sheet, v_src.sheet_name),
              source_row      = coalesce(source_row, (r ->> 'row_number')::int),
              last_change_source = 'sheet', last_changed_by = p_actor
            where id = v_case_id;
            c_linked := c_linked + 1;
          else
            -- This tab owns the case: apply changed tracker values. Status only follows the tracker
            -- until someone changes it in the dashboard (status_source = 'app').
            update public.cases set
              client_id       = coalesce(v_client, client_id),
              client_name     = coalesce(nullif(r ->> 'client_name', ''), client_name),
              client_poc_id   = coalesce(v_poc, client_poc_id),
              escalation_date = case when escalation_date_estimated and v_esc is not null and not v_est then v_esc else escalation_date end,
              escalation_date_estimated = escalation_date_estimated and (v_est or v_esc is null),
              location        = coalesce(nullif(r ->> 'location', ''), location),
              hub             = coalesce(nullif(r ->> 'hub', ''), hub),
              delivery_date   = coalesce(nullif(r ->> 'delivery_date', '')::date, delivery_date),
              seller_name     = coalesce(nullif(r ->> 'seller_name', ''), seller_name),
              complaint_type  = coalesce(nullif(r ->> 'complaint_type', ''), complaint_type),
              reason          = coalesce(nullif(r ->> 'reason', ''), reason),
              priority        = coalesce(nullif(r ->> 'priority', ''), priority),
              shipment_status = coalesce(nullif(r ->> 'shipment_status', ''), shipment_status),
              pod_link        = coalesce(nullif(r ->> 'pod_link', ''), pod_link),
              pod_status      = case when r ->> 'pod_status' = 'shared' then 'shared' else pod_status end,
              product_name    = coalesce(nullif(r ->> 'product_name', ''), product_name),
              product_value   = coalesce(nullif(r ->> 'product_value', '')::numeric, product_value),
              order_id        = coalesce(nullif(r ->> 'order_id', ''), order_id),
              rider_name      = coalesce(nullif(r ->> 'rider_name', ''), rider_name),
              rider_id        = coalesce(nullif(r ->> 'rider_id', ''), rider_id),
              email_subject   = coalesce(nullif(r ->> 'email_subject', ''), email_subject),
              team_remark     = coalesce(nullif(r ->> 'team_remark', ''), team_remark),
              client_remark   = coalesce(nullif(r ->> 'client_remark', ''), client_remark),
              assigned_agent  = coalesce(v_agent, assigned_agent),
              assigned_agent_name = coalesce(nullif(trim(r ->> 'agent_name'), ''), assigned_agent_name),
              source_row      = (r ->> 'row_number')::int,
              team_status     = case when status_source = 'import' and v_cat not in ('lost', 'lost_pending') and not v_lost_signal
                                     then v_status else team_status end,
              closure_date    = case when status_source = 'import' and public.status_category_of(v_status) = 'closed'
                                     then coalesce(nullif(r ->> 'closure_date', '')::date, closure_date) else closure_date end,
              extra           = extra || coalesce(r -> 'extra', '{}'::jsonb),
              last_change_source = 'sheet', last_changed_by = p_actor
            where id = v_case_id;
            c_updated := c_updated + 1;
          end if;

          -- Tracker says Lost on an existing case -> raise a request, at most once per case from sheets.
          if v_lost_signal and v_cat not in ('lost', 'lost_pending')
             and not exists (select 1 from public.lost_approvals where case_id = v_case_id and requested_via = 'google_sheet') then
            select team_status into v_case.team_status from public.cases where id = v_case_id;
            insert into public.lost_approvals (case_id, requested_by, requested_via, request_reason, previous_status)
            values (v_case_id, p_actor, 'google_sheet',
                    coalesce(nullif(r ->> 'status_raw', ''), 'Marked Lost in tracker') || ' (' || v_src.sheet_name || ')', v_case.team_status);
            perform set_config('app.lost_flow', 'on', true);
            update public.cases set team_status = 'lost_pending_approval', lost_requested_at = now(), last_change_source = 'sheet'
             where id = v_case_id;
            perform set_config('app.lost_flow', 'off', true);
            insert into public.case_updates (case_id, action, note, source, client_visible, user_id)
            values (v_case_id, 'lost_requested', 'Marked Lost in Google Sheet "' || v_src.sheet_name || '" — waiting for Admin approval', 'sheet', true, p_actor);
            c_lost := c_lost + 1;
          end if;
        end if;
      end if;

      insert into public.source_records (source_type, sheet_source_id, workbook_id, sheet_name, row_number,
                                         source_key, record_hash, raw, case_id)
      values ('google_sheet', p_source_id, v_src.workbook_id, v_src.sheet_name, (r ->> 'row_number')::int,
              r ->> 'source_key', r ->> 'record_hash', coalesce(r -> 'raw', '{}'::jsonb), v_case_id)
      on conflict (source_type, source_key) do update
        set record_hash = excluded.record_hash, raw = excluded.raw, row_number = excluded.row_number,
            case_id = excluded.case_id, last_seen_at = now(), last_changed_at = now();
    exception when others then
      perform set_config('app.lost_flow', 'off', true);
      v_errors := v_errors || jsonb_build_object('row', r ->> 'row_number', 'awb', r ->> 'awb', 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('created', c_created, 'updated', c_updated, 'linked', c_linked,
                            'unchanged', c_unchanged, 'skipped', c_skipped, 'lost_requests', c_lost, 'errors', v_errors);
end $$;

-- ---------- Dashboard statistics (RLS applies: security invoker) ----------
create or replace function public.case_stats(p_client_id uuid default null, p_from date default null, p_to date default null,
                                             p_source text default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with base as (
    select * from public.v_cases
    where (p_client_id is null or client_id = p_client_id)
      and (p_from is null or escalation_date >= p_from)
      and (p_to is null or escalation_date <= p_to)
      and (p_source is null or source_type::text = p_source)
  ),
  open_cases as (select * from base where status_category in ('open', 'lost_pending'))
  select jsonb_build_object(
    'total',          (select count(*) from base),
    'open',           (select count(*) from open_cases),
    'sla_breached',   (select count(*) from base where sla_breached),
    'new_today',      (select count(*) from base where escalation_date >= public.app_today() - 1),
    'by_status', coalesce((select jsonb_agg(jsonb_build_object('code', sm.code, 'label', sm.label, 'category', sm.category,
                                                               'color', sm.color, 'count', coalesce(x.n, 0)) order by sm.sort_order)
                  from public.status_master sm
                  left join (select team_status, count(*) n from base group by team_status) x on x.team_status = sm.code
                  where sm.is_active), '[]'::jsonb),
    'by_aging', coalesce((select jsonb_agg(jsonb_build_object('label', ab.label, 'count', coalesce(x.n, 0)) order by ab.sort_order)
                  from public.aging_buckets ab
                  left join (select aging_bucket, count(*) n from open_cases group by aging_bucket) x on x.aging_bucket = ab.label), '[]'::jsonb),
    'by_client', coalesce((select jsonb_agg(t order by t.open desc, t.total desc) from (
                  select coalesce(client_display_name, 'Unassigned') as client, client_id,
                         count(*) as total,
                         count(*) filter (where status_category in ('open', 'lost_pending')) as open,
                         count(*) filter (where team_status = 'pending') as pending,
                         count(*) filter (where team_status = 'lost_pending_approval') as lost_pending,
                         count(*) filter (where team_status = 'lost') as lost,
                         count(*) filter (where team_status = 'pod_shared') as pod_shared,
                         count(*) filter (where sla_breached) as sla_breached
                  from base group by 1, 2) t), '[]'::jsonb),
    'by_hub', coalesce((select jsonb_agg(t order by t.open desc) from (
                  select coalesce(hub, location, 'Unknown') as hub, count(*) as open,
                         count(*) filter (where sla_breached) as sla_breached
                  from open_cases group by 1 order by 2 desc limit 15) t), '[]'::jsonb),
    'by_agent', coalesce((select jsonb_agg(t order by t.open desc) from (
                  select coalesce(agent_display_name, 'Unassigned') as agent, count(*) as open,
                         count(*) filter (where sla_breached) as sla_breached,
                         round(avg(aging_days)::numeric, 1) as avg_aging
                  from open_cases group by 1 order by 2 desc limit 15) t), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source', s, 'total', coalesce(x.total, 0), 'open', coalesce(x.open, 0)))
                  from unnest(array['google_sheet', 'email', 'manual']) s
                  left join (select source_type::text st, count(*) total,
                                    count(*) filter (where status_category in ('open', 'lost_pending')) open
                             from base group by 1) x on x.st = s), '[]'::jsonb)
  )
$$;

-- ---------- Daily admin report data (computed from the database, never from sheets) ----------
create or replace function public.daily_report_data(p_lost_days int default 30)
returns jsonb language sql stable security invoker set search_path = public as $$
  with base as (select * from public.v_cases),
  open_cases as (select * from base where status_category in ('open', 'lost_pending')),
  top_clients as (
    select client_display_name as client, count(*) as n from open_cases
    group by 1 order by 2 desc limit 10
  )
  select jsonb_build_object(
    'generated_at', now(),
    'report_date', public.app_today(),
    'summary', jsonb_build_object(
      'total_cases',      (select count(*) from base),
      'total_open',       (select count(*) from open_cases),
      'new_escalations',  (select count(*) from base where escalation_date >= public.app_today() - 1),
      'pending',          (select count(*) from base where team_status = 'pending'),
      'working_on_it',    (select count(*) from base where team_status = 'working_on_it'),
      'pod_shared',       (select count(*) from base where team_status = 'pod_shared'),
      'shipment_at_dc',   (select count(*) from base where team_status = 'shipment_at_dc'),
      'shipment_at_hub',  (select count(*) from base where team_status = 'shipment_at_hub'),
      'lost_pending',     (select count(*) from base where team_status = 'lost_pending_approval'),
      'lost',             (select count(*) from base where status_category = 'lost'),
      'closed',           (select count(*) from base where status_category = 'closed'),
      'tat_breached',     (select count(*) from base where sla_breached)
    ),
    'client_wise', coalesce((select jsonb_agg(t order by t.open desc, t.total desc) from (
        select coalesce(client_display_name, 'Unassigned') as client,
               count(*) as total,
               count(*) filter (where status_category in ('open', 'lost_pending')) as open,
               count(*) filter (where team_status = 'pending') as pending,
               count(*) filter (where team_status = 'lost_pending_approval') as lost_pending,
               count(*) filter (where status_category = 'lost') as lost,
               count(*) filter (where team_status = 'pod_shared') as pod_shared,
               count(*) filter (where status_category in ('open', 'lost_pending') and aging_days <= 7) as aging_0_7,
               count(*) filter (where status_category in ('open', 'lost_pending') and aging_days between 8 and 15) as aging_8_15,
               count(*) filter (where status_category in ('open', 'lost_pending') and aging_days between 16 and 30) as aging_16_30,
               count(*) filter (where status_category in ('open', 'lost_pending') and aging_days > 30) as aging_30_plus
        from base group by 1) t), '[]'::jsonb),
    'aging_wise', coalesce((select jsonb_agg(jsonb_build_object('label', ab.label, 'count', coalesce(x.n, 0)) order by ab.sort_order)
        from public.aging_buckets ab
        left join (select aging_bucket, count(*) n from open_cases group by 1) x on x.aging_bucket = ab.label), '[]'::jsonb),
    -- Rows: the 10 clients with the most open cases. Columns: aging day 1..10 and 10+.
    'top10_aging', coalesce((select jsonb_agg(t order by t.total desc) from (
        select coalesce(tc.client, 'Unassigned') as client, tc.n as total,
               (select jsonb_object_agg(d::text, coalesce(x.cnt, 0))
                  from generate_series(1, 11) d
                  left join (select least(greatest(oc.aging_days, 1), 11) as dd, count(*) as cnt
                               from open_cases oc
                              where oc.client_display_name is not distinct from tc.client
                              group by 1) x on x.dd = d) as by_day
        from top_clients tc) t), '[]'::jsonb),
    'top10_value', coalesce((select jsonb_agg(t) from (
        select row_number() over (order by product_value desc) as rank, awb, client_display_name as client,
               product_name, product_value, aging_days, status_label as status
        from base where product_value is not null and status_category in ('open', 'lost_pending')
        order by product_value desc limit 10) t), '[]'::jsonb),
    'top10_awb_count', coalesce((select jsonb_agg(t) from (
        select row_number() over (order by count(*) desc) as rank, coalesce(client_display_name, 'Unassigned') as client,
               count(*) as awb_count,
               count(*) filter (where status_category in ('open', 'lost_pending')) as pending_count,
               count(*) filter (where status_category = 'lost') as lost_count,
               round(avg(aging_days) filter (where status_category in ('open', 'lost_pending'))::numeric, 1) as avg_aging
        from base group by 2 order by count(*) desc limit 10) t), '[]'::jsonb),
    'lost_cases', coalesce((select jsonb_agg(t order by t.approved_at desc) from (
        select client_display_name as client, awb, escalation_date, aging_days, coalesce(hub, location) as hub,
               reason, team_remark as final_remark, lost_approved_at as approved_at
        from base where status_category = 'lost'
          and lost_approved_at >= now() - make_interval(days => p_lost_days)
        order by lost_approved_at desc limit 200) t), '[]'::jsonb),
    'lost_total', (select count(*) from base where status_category = 'lost'),
    'pending_lost', coalesce((select jsonb_agg(t order by t.requested_at) from (
        select b.client_display_name as client, b.awb, b.escalation_date, b.aging_days, coalesce(b.hub, b.location) as hub,
               la.request_reason as reason, la.requested_at, la.requested_via,
               coalesce(p.full_name, p.email) as requested_by
        from public.lost_approvals la
        join base b on b.id = la.case_id
        left join public.profiles p on p.id = la.requested_by
        where la.status = 'pending'
        order by la.requested_at limit 500) t), '[]'::jsonb),
    'pending_lost_total', (select count(*) from public.lost_approvals where status = 'pending')
  )
$$;

-- ---------- Data quality ----------
create or replace function public.data_quality_summary()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'estimated_escalation_date', (select count(*) from public.cases where escalation_date_estimated and not is_deleted),
    'missing_client',            (select count(*) from public.cases where client_id is null and not is_deleted),
    'missing_hub',               (select count(*) from public.cases where hub is null and location is null and not is_deleted),
    'open_duplicates',           (select count(*) from (
                                    select awb from public.v_cases where status_category in ('open', 'lost_pending')
                                    group by awb having count(*) > 1) d),
    'unmatched_clients', coalesce((select jsonb_agg(t) from (
                                    select client_name, count(*) as cases from public.cases
                                    where client_id is null and client_name is not null and not is_deleted
                                    group by 1 order by 2 desc limit 50) t), '[]'::jsonb),
    'unmapped_statuses', coalesce((select jsonb_agg(t) from (
                                    select v as value, count(*) as cases from public.cases,
                                           jsonb_array_elements_text(coalesce(extra -> 'unmapped_status', '[]'::jsonb)) v
                                    where not is_deleted group by 1 order by 2 desc limit 50) t), '[]'::jsonb),
    'emails_needing_review',     (select count(*) from public.emails where status = 'needs_review'),
    'failed_syncs', coalesce((select jsonb_agg(t) from (
                                    select id, workbook_name, sheet_name, last_sync_status, last_sync_message, last_synced_at
                                    from public.sheet_sources where is_active and last_sync_status in ('failed', 'partial')) t), '[]'::jsonb)
  )
$$;

-- ---------- Function privileges ----------
revoke execute on function public.import_sheet_rows(uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.notify_admins(text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.request_lost(uuid, text) from public, anon;
revoke execute on function public.decide_lost(uuid, text, text) from public, anon;
revoke execute on function public.decide_lost_bulk(uuid[], text, text) from public, anon;
revoke execute on function public.reopen_lost_case(uuid, text, text) from public, anon;
grant execute on function public.import_sheet_rows(uuid, jsonb, uuid) to service_role;
grant execute on function public.request_lost(uuid, text) to authenticated;
grant execute on function public.decide_lost(uuid, text, text) to authenticated;
grant execute on function public.decide_lost_bulk(uuid[], text, text) to authenticated;
grant execute on function public.reopen_lost_case(uuid, text, text) to authenticated;
