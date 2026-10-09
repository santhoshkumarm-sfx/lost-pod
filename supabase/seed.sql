-- =====================================================================
-- Reference data + the trackers shared by the team (Sept 2026).
-- Safe to re-run: every insert is idempotent.
-- =====================================================================

-- ---------- Statuses ----------
insert into public.status_master (code, label, category, sort_order, color, is_system, allow_manual) values
  ('pending',               'Pending',                       'open',         10, 'slate',  true, true),
  ('working_on_it',         'Working on it',                 'open',         20, 'blue',   true, true),
  ('shipment_at_dc',        'Shipment at DC',                'open',         30, 'indigo', true, true),
  ('shipment_at_hub',       'Shipment at Hub',               'open',         40, 'violet', true, true),
  ('pod_shared',            'POD Shared',                    'open',         50, 'teal',   true, true),
  ('lost_pending_approval', 'Lost — Pending Approval', 'lost_pending', 60, 'amber',  true, false),
  ('lost',                  'Lost',                          'lost',         70, 'red',    true, false),
  ('closed',                'Closed',                        'closed',       80, 'green',  true, true)
on conflict (code) do nothing;

-- ---------- Aging buckets ----------
insert into public.aging_buckets (label, min_days, max_days, sort_order) values
  ('0–2', 0, 2, 1), ('3–7', 3, 7, 2), ('8–15', 8, 15, 3), ('16–30', 16, 30, 4),
  ('31–60', 31, 60, 5), ('61–90', 61, 90, 6), ('90+', 91, null, 7)
on conflict (label) do nothing;

-- ---------- Settings ----------
insert into public.app_settings (key, value, description) values
  ('timezone',              '"Asia/Kolkata"', 'Timezone used for "today" when calculating aging'),
  ('default_sla_days',      '7',              'Open cases older than this (days) count as TAT/SLA breached, unless the client has its own SLA'),
  ('dedupe_window_days',    '30',             'Same AWB + client escalated within this many days is treated as the same case'),
  ('report_recipients',     '["santhoshkumar.m@shadowfax.in","naveed.iqbal@shadowfax.in","binay.sharma@shadowfax.in"]', 'Daily admin report recipients'),
  ('report_aging_order',    '"asc"',          'Top 10 aging table column order: "asc" = 1 → 10+ left to right, "desc" = 10+ → 1'),
  ('report_lost_body_days', '30',             'Approved Lost cases from the last N days are listed in the email body (all are in the attachment)'),
  ('notify_admins_by_email','false',          'Send emails automatically (new Lost requests and Lost decisions). Off = no automatic emails.'),
  ('awb_patterns',          '["\\b(?:SF|R)\\d{7,16}[A-Z]{1,4}\\b"]', 'Regular expressions used to find AWBs in email text'),
  ('hub_city_codes',        '{}',             'Extra hub prefix → city mappings, e.g. {"PWL":"Palwal"}')
on conflict (key) do nothing;

-- ---------- Status wording seen in the trackers ----------
insert into public.status_mappings (pattern, match_type, status_code, priority) values
  ('pending', 'exact', 'pending', 10), ('open', 'exact', 'pending', 10), ('new', 'exact', 'pending', 10),
  ('pod pending', 'contains', 'pending', 60), ('please share pod', 'contains', 'pending', 60),
  ('working on it', 'exact', 'working_on_it', 10), ('working', 'exact', 'working_on_it', 10),
  ('wip', 'exact', 'working_on_it', 10), ('in progress', 'exact', 'working_on_it', 10),
  ('under investigation', 'contains', 'working_on_it', 50), ('in rto/rts process', 'exact', 'working_on_it', 10),
  ('will share tomorrow', 'contains', 'working_on_it', 50), ('wrong closure', 'contains', 'working_on_it', 50),
  ('shipment at dc', 'exact', 'shipment_at_dc', 10), ('at dc', 'exact', 'shipment_at_dc', 10),
  ('shipment at hub', 'exact', 'shipment_at_hub', 10), ('at hub', 'exact', 'shipment_at_hub', 10),
  ('pod shared', 'exact', 'pod_shared', 10), ('pod sent', 'exact', 'pod_shared', 10), ('pod shared', 'contains', 'pod_shared', 40),
  ('lost', 'exact', 'lost_pending_approval', 10), ('need lost', 'contains', 'lost_pending_approval', 30),
  ('mark lost', 'contains', 'lost_pending_approval', 30), ('lost', 'contains', 'lost_pending_approval', 70),
  ('closed', 'exact', 'closed', 10), ('close', 'exact', 'closed', 10), ('successfully closed', 'exact', 'closed', 10),
  ('unsuccessfully closed', 'exact', 'closed', 10), ('received', 'exact', 'closed', 10), ('resolved', 'exact', 'closed', 10),
  ('closed', 'contains', 'closed', 80)
on conflict (pattern, match_type) do nothing;

-- ---------- Header aliases (normalised: lower case, letters and digits only) ----------
insert into public.column_aliases (alias, target_field) values
  ('awb','awb'),('awbno','awb'),('awbnumber','awb'),('awbnum','awb'),('trackingnumber','awb'),('trackingno','awb'),
  ('trackingid','awb'),('connectedawb','awb'),('waybill','awb'),('waybillno','awb'),('shipmentid','awb'),
  ('escdate','escalation_date'),('escalationdate','escalation_date'),('date','escalation_date'),
  ('escalateddate','escalation_date'),('raiseddate','escalation_date'),('complaintdate','escalation_date'),
  ('ageing','ignore'),('aging','ignore'),('aeging','ignore'),('podageing','ignore'),('month','ignore'),
  ('lastupdated','ignore'),('dspawbnumber','ignore'),('courierpartner','ignore'),('customerpincode','ignore'),
  ('codamount','ignore'),('paymentmode','ignore'),('scheduleddate','ignore'),('orderdate','ignore'),
  ('attemptnumber','ignore'),('cancelleddate','ignore'),('laststatusupdate','ignore'),('receivedathubtime','ignore'),
  ('requesttype','ignore'),('statechangeremarks','ignore'),('orderremarks','ignore'),
  ('client','client_name'),('clientname','client_name'),('customer','client_name'),('account','client_name'),
  ('poc','poc_name'),('clientpoc','poc_name'),('pocname','poc_name'),('spoc','poc_name'),
  ('location','location'),('city','location'),('wh','location'),('warehouse','location'),('destination','location'),
  ('hub','hub'),('hubname','hub'),('hubdc','hub'),('dc','hub'),('hubcode','hub'),
  ('deliverydate','delivery_date'),('delivereddate','delivery_date'),('deliveredon','delivery_date'),('dlvdate','delivery_date'),
  ('sellername','seller_name'),('seller','seller_name'),('merchantname','seller_name'),('merchant','seller_name'),('vendor','seller_name'),
  ('podlink','pod_link'),('podlinks','pod_link'),('pod','pod_link'),('links','pod_link'),('link','pod_link'),
  ('podlinkmailsubject','pod_link'),('podlinkandremark','pod_link'),
  ('remark','team_remark'),('remarks','team_remark'),('remarks1','team_remark'),('sfxremark','team_remark'),
  ('sfxremarks','team_remark'),('shadowfaxremark','team_remark'),('shadowfaxremarks','team_remark'),
  ('clientremark','client_remark'),('clientremarks','client_remark'),('swremarks','client_remark'),
  ('swiftremark','client_remark'),('prozoremarks','client_remark'),('clientcomment','client_remark'),
  ('status','status_raw'),('casestatus','status_raw'),('casetype','status_raw'),('teamstatus','status_raw'),('finalstatus','status_raw'),
  ('podstatus','pod_status'),
  ('currentstatus','shipment_status'),('shipmentstatus','shipment_status'),('orderstatus','shipment_status'),('podtype','shipment_status'),
  ('priority','priority'),('prioritytype','priority'),('severity','priority'),
  ('complainttype','complaint_type'),('issuetype','complaint_type'),('escalationtype','complaint_type'),
  ('reason','reason'),('issue','reason'),('concern','reason'),
  ('agent','agent_name'),('agentname','agent_name'),('assignedto','agent_name'),('owner','agent_name'),
  ('rider','rider_name'),('ridername','rider_name'),('riderid','rider_id'),
  ('closuredate','closure_date'),('closeddate','closure_date'),('resolutiondate','closure_date'),
  ('mailsubject','email_subject'),('emailsubject','email_subject'),('subject','email_subject'),
  ('productname','product_name'),('product','product_name'),('itemname','product_name'),('item','product_name'),
  ('productvalue','product_value'),('price','product_value'),('value','product_value'),('invoicevalue','product_value'),
  ('declaredvalue','product_value'),('ordervalue','product_value'),('mrp','product_value'),
  ('clientorderid','order_id'),('orderid','order_id'),
  ('podlinksmailsubjects','pod_link'),('podlinksmailsubject','pod_link'),('suborderno','order_id'),
  ('syedremakes','ignore'),('syedremarks','ignore'),('aseemremarks','ignore'),('assemremarks','ignore'),('tata1mg','ignore'),
  ('awbnumber','awb'),('lostmarkdate','ignore'),('sharedate','ignore')
on conflict (alias) do nothing;

-- ---------- Clients ----------
insert into public.clients (name, code, aliases) values
  ('Velocity',   'VEL', '{"Velocity Prime","Velocity Shipping"}'),
  ('Prozo',      'PRZ', '{"Prozo Express","Prozo all"}'),
  ('Kartrocket', 'KRT', '{"Kart Rocket"}'),
  ('Shiprocket', 'SHR', '{"Ship Rocket"}'),
  ('Naaptol',    'NAP', '{}'),
  ('Lenskart',   'LNK', '{}'),
  ('Swift',      'SWF', '{"Swift Premium","Swift Prime","Swift Renee","Swiftship"}'),
  ('Snapdeal',   'SDL', '{"Snap deal"}'),
  ('JioMart',    'JIO', '{"Jio Mart","Jiomart","Reliance JioMart"}'),
  ('Shipdelight','SHD', '{"Ship delight","Ship Delight"}'),
  ('TataCliq',   'TCQ', '{"Tata Cliq","Tatacliq","Tata CLiQ"}'),
  ('Firstcry',   'FCY', '{"First cry","FirstCry"}'),
  ('TATA 1MG',   'T1M', '{"Tata 1mg","1mg","1 MG"}'),
  ('CityMall',   'CTM', '{"City mall","Citymall"}')
on conflict (name) do nothing;

-- ---------- Tracker tabs shared on 14 Sep 2026 ----------
-- Tabs that hold escalations use mode 'cases'. Lookup dumps ("Rough sheet", AWB → POD link lists)
-- use mode 'enrich': they only fill gaps (price, POD link, hub) on cases that already exist.
with c as (select id, name from public.clients)
insert into public.sheet_sources (workbook_id, workbook_name, sheet_name, default_client_id, mode, is_active, column_map) values
  ('17y1-5ZU3WHMW2FutHT9U5gfOY7rbSfR_4ljuav90RTg', 'Velocity — RTO/RTS POD requirements', 'Sheet1',
     (select id from c where name='Velocity'), 'cases', true, '[]'),
  ('17y1-5ZU3WHMW2FutHT9U5gfOY7rbSfR_4ljuav90RTg', 'Velocity — RTO/RTS POD requirements', 'Rough sheet',
     (select id from c where name='Velocity'), 'enrich', true, '[]'),
  ('17y1-5ZU3WHMW2FutHT9U5gfOY7rbSfR_4ljuav90RTg', 'Velocity — RTO/RTS POD requirements', 'Sheet7',
     (select id from c where name='Velocity'), 'enrich', false, '[]'),

  ('1boOUEZUXklIDkRYE_3CXuffeIB4wmfV_MOPIs1yQdwo', 'Prozo', 'Prozo',
     (select id from c where name='Prozo'), 'cases', true, '[{"index":3,"target":"ignore"}]'),
  ('1boOUEZUXklIDkRYE_3CXuffeIB4wmfV_MOPIs1yQdwo', 'Prozo', 'Express',
     (select id from c where name='Prozo'), 'cases', true, '[{"index":4,"target":"ignore"},{"index":7,"target":"ignore"},{"index":12,"target":"status_raw"},{"index":14,"target":"ignore"}]'),
  ('1boOUEZUXklIDkRYE_3CXuffeIB4wmfV_MOPIs1yQdwo', 'Prozo', 'Prozo - New sheet',
     (select id from c where name='Prozo'), 'cases', true, '[]'),
  ('1boOUEZUXklIDkRYE_3CXuffeIB4wmfV_MOPIs1yQdwo', 'Prozo', 'Express - New sheet',
     (select id from c where name='Prozo'), 'cases', true, '[]'),
  ('1boOUEZUXklIDkRYE_3CXuffeIB4wmfV_MOPIs1yQdwo', 'Prozo', 'Rough sheet',
     (select id from c where name='Prozo'), 'enrich', false, '[]'),

  ('197bQHnWACtMEILusmDCl_C-9xmA7xqIS87B5wHEiN-4', 'Kartrocket POD Requirements 2026', 'Sanjeev D - From July',
     (select id from c where name='Kartrocket'), 'cases', true, '[]'),
  ('197bQHnWACtMEILusmDCl_C-9xmA7xqIS87B5wHEiN-4', 'Kartrocket POD Requirements 2026', 'Forward - From July',
     (select id from c where name='Kartrocket'), 'cases', true, '[]'),
  ('197bQHnWACtMEILusmDCl_C-9xmA7xqIS87B5wHEiN-4', 'Kartrocket POD Requirements 2026', 'Reverse - From July',
     (select id from c where name='Kartrocket'), 'cases', true, '[]'),
  ('197bQHnWACtMEILusmDCl_C-9xmA7xqIS87B5wHEiN-4', 'Kartrocket POD Requirements 2026', 'Bharat - From July',
     (select id from c where name='Kartrocket'), 'cases', true, '[{"index":12,"target":"client_remark"}]'),
  ('197bQHnWACtMEILusmDCl_C-9xmA7xqIS87B5wHEiN-4', 'Kartrocket POD Requirements 2026', 'Rough sheet',
     (select id from c where name='Kartrocket'), 'enrich', true, '[]'),
  ('197bQHnWACtMEILusmDCl_C-9xmA7xqIS87B5wHEiN-4', 'Kartrocket POD Requirements 2026', 'Sheet5',
     (select id from c where name='Kartrocket'), 'enrich', false, '[]'),

  ('1NWOUFyLVbB-RA9yscuS3UmnAuj6w0aVtDA80mGDJVhs', 'Naaptol', 'Naaptol',
     (select id from c where name='Naaptol'), 'cases', true, '[]'),
  ('1NWOUFyLVbB-RA9yscuS3UmnAuj6w0aVtDA80mGDJVhs', 'Naaptol', 'Sheet8',
     (select id from c where name='Naaptol'), 'enrich', true, '[]'),
  ('1NWOUFyLVbB-RA9yscuS3UmnAuj6w0aVtDA80mGDJVhs', 'Naaptol', 'Rough sheet',
     (select id from c where name='Naaptol'), 'enrich', true, '[{"index":1,"target":"hub"}]'),

  ('1WsOiZ_wL4s8qeLDIdEtcHYOA3vRSC-zsyZOsy5UG7Us', 'Swift <> Shadowfax Critical Escalation', 'Critical Escalations',
     (select id from c where name='Swift'), 'cases', true, '[{"index":6,"target":"client_remark"},{"index":8,"target":"status_raw"},{"index":9,"target":"ignore"}]'),
  ('1WsOiZ_wL4s8qeLDIdEtcHYOA3vRSC-zsyZOsy5UG7Us', 'Swift <> Shadowfax Critical Escalation', 'fwd POD from july',
     (select id from c where name='Swift'), 'cases', true, '[]'),
  ('1WsOiZ_wL4s8qeLDIdEtcHYOA3vRSC-zsyZOsy5UG7Us', 'Swift <> Shadowfax Critical Escalation', 'RVP POD from july',
     (select id from c where name='Swift'), 'cases', true, '[]'),
  ('1WsOiZ_wL4s8qeLDIdEtcHYOA3vRSC-zsyZOsy5UG7Us', 'Swift <> Shadowfax Critical Escalation', 'POD FWD ',
     (select id from c where name='Swift'), 'cases', true, '[]'),
  ('1WsOiZ_wL4s8qeLDIdEtcHYOA3vRSC-zsyZOsy5UG7Us', 'Swift <> Shadowfax Critical Escalation', 'POD RVP ',
     (select id from c where name='Swift'), 'cases', true, '[{"index":8,"target":"hub"},{"index":10,"target":"status_raw"}]'),
  ('1WsOiZ_wL4s8qeLDIdEtcHYOA3vRSC-zsyZOsy5UG7Us', 'Swift <> Shadowfax Critical Escalation', 'Rough sheet',
     (select id from c where name='Swift'), 'enrich', true, '[]'),

  -- Added 9 Oct 2026. Pivot tables and their "Detail…" drill-down copies are not imported (they repeat the main tab).
  ('1zfam9OvaEGre_QsT8_erkl_BzsqV5agHd6eoIiQZGGI', 'Snapdeal', 'Snapdeal',
     (select id from c where name='Snapdeal'), 'cases', true, '[]'),
  ('1zfam9OvaEGre_QsT8_erkl_BzsqV5agHd6eoIiQZGGI', 'Snapdeal', 'TATA 1MG',
     (select id from c where name='TATA 1MG'), 'cases', true, '[{"index":8,"target":"team_remark"}]'),
  ('1zfam9OvaEGre_QsT8_erkl_BzsqV5agHd6eoIiQZGGI', 'Snapdeal', 'citymall',
     (select id from c where name='CityMall'), 'cases', true, '[]'),
  ('1zfam9OvaEGre_QsT8_erkl_BzsqV5agHd6eoIiQZGGI', 'Snapdeal', 'Rough sheet',
     (select id from c where name='Snapdeal'), 'enrich', true, '[]'),

  ('1o8btDW9uclJWHesJjmVtp2H0DIecrH85yW7hqDA6vdU', 'Jiomart RTO/RTS PODs - 2026', 'Jio Mart',
     (select id from c where name='JioMart'), 'cases', true, '[]'),
  ('1o8btDW9uclJWHesJjmVtp2H0DIecrH85yW7hqDA6vdU', 'Jiomart RTO/RTS PODs - 2026', 'Roughsheet',
     (select id from c where name='JioMart'), 'enrich', true, '[]'),

  ('1fTUa1adNa6rfI5teVRCopLA4aG32bhBNfUZM7rYZ3nk', 'SHIPDELIGHT <> SHADOWFAX POD', 'Working ',
     (select id from c where name='Shipdelight'), 'cases', true, '[]'),
  ('1fTUa1adNa6rfI5teVRCopLA4aG32bhBNfUZM7rYZ3nk', 'SHIPDELIGHT <> SHADOWFAX POD', 'Roughsheet',
     (select id from c where name='Shipdelight'), 'enrich', true, '[]'),

  ('1sSw1JAT1NBc2pnTE0u-anLFcmxYQJ5vDo837N-W-7AQ', 'TATACLIQ - RTO/RTS PODs requirements', 'Sheet1',
     (select id from c where name='TataCliq'), 'cases', true, '[]'),
  ('1sSw1JAT1NBc2pnTE0u-anLFcmxYQJ5vDo837N-W-7AQ', 'TATACLIQ - RTO/RTS PODs requirements', 'Sheet14',
     (select id from c where name='TataCliq'), 'cases', false, '[]'),
  ('1sSw1JAT1NBc2pnTE0u-anLFcmxYQJ5vDo837N-W-7AQ', 'TATACLIQ - RTO/RTS PODs requirements', 'Sheet15',
     (select id from c where name='TataCliq'), 'cases', false, '[]'),
  ('1sSw1JAT1NBc2pnTE0u-anLFcmxYQJ5vDo837N-W-7AQ', 'TATACLIQ - RTO/RTS PODs requirements', 'Rough sheet',
     (select id from c where name='TataCliq'), 'enrich', true, '[]'),

  ('1t85yOh0hnPDt9vY7oqSn8eDZRmBXht6DXSEzQ4iUYmE', 'Firstcry PODs - RTO/RTS', 'Sheet1',
     (select id from c where name='Firstcry'), 'cases', true, '[]'),
  ('1t85yOh0hnPDt9vY7oqSn8eDZRmBXht6DXSEzQ4iUYmE', 'Firstcry PODs - RTO/RTS', 'Roughsheet',
     (select id from c where name='Firstcry'), 'enrich', true, '[]')
on conflict (workbook_id, sheet_name) do nothing;
