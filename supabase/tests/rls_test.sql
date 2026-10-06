-- Run against a local database (see README "Testing the database rules").
-- Every check raises an exception on failure, so a clean run means all rules hold.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- Users: role comes from app_metadata (service-role controlled)
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'super@sfx.test', '{"role":"super_admin"}', '{"full_name":"Super Admin"}'),
  ('00000000-0000-0000-0000-000000000002', 'admin@sfx.test', '{"role":"admin"}', '{"full_name":"Asha Admin"}'),
  ('00000000-0000-0000-0000-000000000003', 'agent@sfx.test', '{"role":"internal_team"}', '{"full_name":"Assem Khan"}'),
  ('00000000-0000-0000-0000-000000000004', 'poc@velocity.test', '{"role":"client_poc"}', '{"full_name":"Vel POC"}'),
  ('00000000-0000-0000-0000-000000000005', 'poc@naaptol.test', '{"role":"client_poc"}', '{"full_name":"Naap POC"}'),
  ('00000000-0000-0000-0000-000000000006', 'selfsignup@x.test', '{}', '{"full_name":"Random","role":"super_admin"}');

do $$ begin
  assert (select role from profiles where email='selfsignup@x.test') = 'client_poc', 'self sign-up must not pick a role';
  assert (select not is_active from profiles where email='selfsignup@x.test'), 'self sign-up must be inactive';
end $$;

insert into client_pocs (client_id, user_id, name, email)
select id, '00000000-0000-0000-0000-000000000004', 'Vel POC', 'poc@velocity.test' from clients where name='Velocity';
insert into client_pocs (client_id, user_id, name, email)
select id, '00000000-0000-0000-0000-000000000005', 'Naap POC', 'poc@naaptol.test' from clients where name='Naaptol';

-- Cases (as superuser = service role). Escalated 01-Aug.
insert into cases (awb, client_id, escalation_date, source_type, hub, team_remark)
select 'R2466544662BDM', id, date '2026-08-01', 'manual', 'BLR_DC_FMRTS', 'POD requested from hub' from clients where name='Velocity';
insert into cases (awb, client_id, escalation_date, source_type, hub)
select 'SF3192169858NAA', id, current_date - 5, 'manual', 'DEL_Mundka_FM' from clients where name='Naaptol';
insert into case_private (case_id, internal_remark) select id, 'Rider suspected — do not share' from cases where awb='R2466544662BDM';

-- Lost cannot be set directly, even by the service role.
do $$ begin
  begin
    update cases set team_status='lost' where awb='R2466544662BDM';
    raise exception 'FAIL: direct Lost update was allowed';
  exception when others then
    if sqlerrm not like 'LOST_WORKFLOW%' then raise; end if;
  end;
end $$;

-- ===== POC A (Velocity) =====
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
do $$ begin
  assert (select count(*) from cases) = 1, 'POC must only see own client cases';
  assert (select count(*) from v_cases) = 1, 'POC view must only show own client cases';
  assert (select count(*) from cases where awb='SF3192169858NAA') = 0, 'POC must not see other client AWB';
  assert (select count(*) from case_private) = 0, 'POC must not see internal remarks';
  assert (select count(*) from clients) = 1, 'POC sees only own client';
  assert (select count(*) from emails) = 0, 'POC cannot read emails';
  assert (select count(*) from audit_logs) = 0, 'POC cannot read audit';
end $$;
-- POC cannot update cases at all
update cases set team_remark = 'hacked' where awb='R2466544662BDM';
do $$ begin assert (select team_remark from cases where awb='R2466544662BDM') = 'POD requested from hub', 'POC update must be blocked'; end $$;
-- POC cannot request Lost on another client's case (by guessing the id)
do $$ declare v uuid; begin
  reset role; select id into v from cases where awb='SF3192169858NAA'; set role authenticated;
  begin
    perform request_lost(v, 'not received');
    raise exception 'FAIL: cross-client lost request allowed';
  exception when others then
    if sqlerrm <> 'Case not found' then raise; end if;
  end;
end $$;
-- POC requests Lost on own case -> pending approval, not Lost
select request_lost((select id from cases where awb='R2466544662BDM'), 'Seller confirms shipment never received');
do $$ begin
  assert (select team_status from cases where awb='R2466544662BDM') = 'lost_pending_approval', 'POC request must only set pending approval';
  assert (select count(*) from lost_approvals where status='pending') = 1, 'approval row expected';
end $$;
reset role;

-- ===== Internal agent =====
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
do $$ begin
  assert (select count(*) from cases) = 2, 'agent sees all cases';
  begin
    perform decide_lost((select id from lost_approvals limit 1), 'approved', null);
    raise exception 'FAIL: agent approved lost';
  exception when others then
    if sqlerrm not like 'Only an Admin%' then raise; end if;
  end;
  begin
    update cases set team_status = 'closed' where awb='R2466544662BDM';
    raise exception 'FAIL: agent moved a case out of the Lost workflow';
  exception when others then
    if sqlerrm not like 'LOST_WORKFLOW%' then raise; end if;
  end;
  begin
    update cases set is_deleted = true where awb='SF3192169858NAA';
    raise exception 'FAIL: agent soft-deleted a case';
  exception when others then
    if sqlerrm not like 'Only an Admin%' then raise; end if;
  end;
end $$;
update cases set team_status='working_on_it', assigned_agent=auth.uid() where awb='SF3192169858NAA';
reset role;

-- ===== Admin approves (approved "today"; aging measured from 01-Aug) =====
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select decide_lost((select id from lost_approvals where status='pending' limit 1), 'approved', 'Confirmed with hub');
do $$ begin
  assert (select team_status from cases where awb='R2466544662BDM') = 'lost', 'approved -> Lost';
  assert (select final_aging_days from cases where awb='R2466544662BDM') = app_today() - date '2026-08-01', 'lost aging from original escalation date';
  assert (select count(*) from case_updates c join cases k on k.id=c.case_id where k.awb='R2466544662BDM' and c.action in ('lost_requested','lost_approved')) = 2, 'approval history';
  begin
    update profiles set role='super_admin' where email='agent@sfx.test';
    raise exception 'FAIL: admin granted super admin';
  exception when others then
    if sqlerrm not like 'Only a Super Admin%' then raise; end if;
  end;
  begin
    update profiles set is_active=false where id = auth.uid();
    raise exception 'FAIL: admin changed own access';
  exception when others then
    if sqlerrm not like 'You cannot change your own%' then raise; end if;
  end;
end $$;
reset role;

-- POC sees only client-visible history
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
do $$ begin
  assert (select count(*) from case_updates where not client_visible) = 0, 'POC sees only client-visible history';
  assert (select count(*) from case_updates) > 0, 'POC sees its timeline';
  assert (select count(*) from notifications where type <> 'lost_decision') = 0, 'POC gets only its own decision notices';
  assert (select count(*) from notifications where type = 'lost_decision') = 1, 'POC is told the outcome of its request';
end $$;
reset role;

-- ===== Sheet import: create, unchanged, link, lost signal =====
do $$
declare v_src uuid; v_res jsonb; v_client uuid;
begin
  select id, default_client_id into v_src, v_client from sheet_sources where sheet_name='Sheet1';
  v_res := import_sheet_rows(v_src, jsonb_build_array(
    jsonb_build_object('source_key','t:SF3583535088VEO:2026-07-17','record_hash','h1','row_number',6,'awb','SF3583535088VEO',
      'client_id',v_client,'escalation_date','2026-07-17','hub','DEL_KirtiNagar_RTS','status_code','pod_shared','pod_status','shared',
      'pod_link','https://drive.google.com/x','team_remark','POD shared','agent_name','Assem'),
    jsonb_build_object('source_key','t:R2131834705VEO:2026-07-14','record_hash','h2','row_number',13,'awb','R2131834705VEO',
      'client_id',v_client,'escalation_date','2026-07-14','status_code','lost_pending_approval','status_raw','Lost'),
    jsonb_build_object('source_key','t:R2466544662BDM:2026-08-03','record_hash','h3','row_number',20,'awb','R2466544662BDM',
      'client_id',v_client,'escalation_date','2026-08-03','seller_name','Warrior World','status_code','pod_shared')
  ), null);
  assert (v_res->>'created')::int = 2, 'two new cases: ' || v_res::text;
  assert (v_res->>'linked')::int = 1, 'existing AWB within window links instead of duplicating: ' || v_res::text;
  assert (v_res->>'lost_requests')::int = 1, 'tracker Lost becomes a request';
  assert (select team_status from cases where awb='R2131834705VEO') = 'lost_pending_approval', 'imported Lost is pending only';
  assert (select assigned_agent from cases where awb='SF3583535088VEO') = '00000000-0000-0000-0000-000000000003', 'agent first-name match';
  assert (select team_status from cases where awb='R2466544662BDM') = 'lost', 'link must not change status of a Lost case';
  assert (select seller_name from cases where awb='R2466544662BDM') = 'Warrior World', 'link fills gaps';
  v_res := import_sheet_rows(v_src, jsonb_build_array(
    jsonb_build_object('source_key','t:SF3583535088VEO:2026-07-17','record_hash','h1','row_number',6,'awb','SF3583535088VEO')), null);
  assert (v_res->>'unchanged')::int = 1, 'unchanged row skipped';
end $$;

-- ===== Email escalation -> cases (internal agent) =====
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
insert into emails (gmail_thread_id, gmail_message_id, subject, sender, sender_email, email_date)
values ('thread-1', 'msg-1', 'POD needed - Shadowfax - 11-09-26', 'Ops <ops@velocity.test>', 'ops@velocity.test', now());
do $$ declare v_res jsonb; v_email uuid; v_client uuid; v_link uuid; begin
  select id into v_email from emails where gmail_thread_id = 'thread-1';
  select id into v_client from clients where name = 'Velocity';
  select id into v_link from cases where awb = 'SF3583535088VEO';
  v_res := create_email_cases(v_email,
    jsonb_build_object('client_id', v_client, 'escalation_date', '2026-09-11', 'reason', 'Please provide POD', 'complaint_type', 'POD request'),
    jsonb_build_array(
      jsonb_build_object('awb', 'r2460991811bdm', 'location', 'Jaipur'),
      jsonb_build_object('awb', 'R2499991811BDM', 'location', 'Bangalore'),
      jsonb_build_object('awb', 'SF3583535088VEO', 'link_case_id', v_link)));
  assert (v_res->>'created')::int = 2 and (v_res->>'linked')::int = 1, 'email creates 2 and links 1: ' || v_res::text;
  assert (select count(*) from cases where email_thread_id = 'thread-1') = 3, 'all cases carry the thread id';
  assert (select source_type from cases where awb = 'R2460991811BDM') = 'email', 'source is email';
  assert (select location from cases where awb = 'R2460991811BDM') = 'Jaipur', 'row field kept';
  assert (select source_type from cases where awb = 'SF3583535088VEO') = 'google_sheet', 'linked case keeps its source';
  assert (select status from emails where id = v_email) = 'processed', 'email marked processed';
  assert (select count(*) from source_records where source_type = 'email' and email_id = v_email) = 3, 'email lineage stored';
  assert (select count(*) from find_existing_cases(array['r2460991811bdm'])) = 1, 'duplicate lookup';
end $$;
reset role;
-- A POC cannot create cases from email
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);
do $$ begin
  begin
    perform create_email_cases(gen_random_uuid(), '{}'::jsonb, '[]'::jsonb);
    raise exception 'FAIL: POC created email cases';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

-- Analytics run cleanly
select (case_stats()->>'total')::int as total_cases;
select jsonb_array_length(daily_report_data()->'top10_aging') as top10_rows;
select data_quality_summary()->>'missing_hub' as missing_hub;
select 'ALL RLS / WORKFLOW CHECKS PASSED' as result;
