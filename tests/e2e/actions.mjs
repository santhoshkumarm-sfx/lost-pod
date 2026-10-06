// Calls server actions the way a browser without JavaScript would (form POST with $ACTION_ID_<id>).
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { sessionCookie } from './jwt.mjs';

const BASE = 'http://localhost:3000';
const manifest = JSON.parse(readFileSync('.next/server/server-reference-manifest.json', 'utf8')).node;
const idOf = (file, name) => Object.entries(manifest).find(([, v]) => v.filename === file && v.exportedName === name)?.[0];
const sql = (q) => execSync(`psql -h /tmp -p 5433 -U postgres -d lostpod_api -At -c "${q.replace(/"/g, '\\"')}"`).toString().trim();
let failures = 0;

async function act(role, page, file, name, fields) {
  const id = idOf(file, name);
  if (!id) throw new Error(`no action ${file}#${name}`);
  const fd = new FormData();
  fd.append(`$ACTION_ID_${id}`, '');
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) fd.append(k, x);
  const r = await fetch(BASE + page, { method: 'POST', body: fd, headers: { cookie: sessionCookie(role) }, redirect: 'manual' });
  const loc = decodeURIComponent((r.headers.get('location') ?? '').replace(/\+/g, ' '));
  return { status: r.status, loc };
}
function expect(label, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond ? '' : `  → ${detail}`}`);
}
const caseId = (awb) => sql(`select id from cases where awb='${awb}' and not is_deleted order by created_at desc limit 1`);
const C = 'app/(internal)/cases/actions.ts';

// 1. Agent updates status + remark on an unassigned case → status_source becomes app
let id = caseId('R2131834705VEO');
let r = await act('agent', `/cases/${id}`, C, 'updateCase', { id, team_status: 'shipment_at_hub', team_remark: 'Shipment found at Palwal hub', pod_status: 'pending', assigned_agent: '' });
expect('agent updates a case', r.loc.includes('ok=Case updated'), r.loc);
expect('status saved and stops following the tracker', sql(`select team_status||','||status_source from cases where id='${id}'`) === 'shipment_at_hub,app', sql(`select team_status||','||status_source from cases where id='${id}'`));
expect('history written', Number(sql(`select count(*) from case_updates where case_id='${id}' and field='team_status'`)) === 1, 'no history');

// 2. Agent asks for Lost; non-admin cannot approve; admin approves; aging from original escalation date
r = await act('agent', `/cases/${id}`, C, 'requestLost', { id, reason: 'Hub cannot trace after 3 searches' });
expect('agent requests Lost', r.loc.includes('ok=Lost request sent'), r.loc);
const appr = sql(`select id from lost_approvals where case_id='${id}' and status='pending'`);
r = await act('agent', '/lost-approval', C, 'decideLost', { approval_id: appr, decision: 'approved', back: '/lost-approval' });
expect('agent cannot approve Lost', r.loc.includes('Admin access needed') && sql(`select team_status from cases where id='${id}'`) === 'lost_pending_approval', r.loc);
r = await act('admin', '/lost-approval', C, 'decideLost', { approval_id: appr, decision: 'rejected', note: '', back: '/lost-approval' });
expect('reject needs a note', r.loc.includes('error=Add a note'), r.loc);
r = await act('admin', '/lost-approval', C, 'decideLost', { approval_id: appr, decision: 'approved', note: 'Approved after hub audit', back: '/lost-approval' });
expect('admin approves Lost', r.loc.includes('approved'), r.loc);
expect('final aging = approval date - escalation date', sql(`select (final_aging_days = current_date - escalation_date)::text from cases where id='${id}'`) === 'true', sql(`select final_aging_days, escalation_date from cases where id='${id}'`));
r = await act('agent', `/cases/${id}`, C, 'updateCase', { id, team_status: 'pending', pod_status: 'pending' });
expect('Lost case cannot be edited out of Lost', r.loc.includes('error='), r.loc);

// 3. Manual case: duplicate warning, then forced
r = await act('agent', '/cases/new', C, 'createCases', { awbs: 'R2466544662BDM', escalation_date: '2026-10-01', client_id: sql(`select id from clients where name='Velocity'`) });
expect('duplicate AWB warning', r.loc.includes('Open cases already exist for R2466544662BDM'), r.loc);
r = await act('agent', '/cases/new', C, 'createCases', { awbs: 'R2466544662BDM, sf9999999999abc', escalation_date: '2026-10-01', confirm_duplicates: '1', client_id: sql(`select id from clients where name='Velocity'`) });
expect('manual cases created', r.loc.includes('ok=2 cases created'), r.loc);
r = await act('agent', '/cases/new', C, 'createCases', { awbs: 'R1234567890ABC', escalation_date: '2030-01-01' });
expect('future escalation date rejected', r.loc.includes('error='), r.loc);

// 4. Comments and portal
id = caseId('R2111303762VEO');
r = await act('agent', `/cases/${id}`, C, 'addComment', { id, body: 'POD re-uploaded, please check', visibility: 'client' });
await act('agent', `/cases/${id}`, C, 'addComment', { id, body: 'Rider under watch — do not share', visibility: 'internal' });
await act('agent', `/cases/${id}`, C, 'saveInternalNote', { id, internal_remark: 'SECRET-INTERNAL-NOTE' });
const portal = await (await fetch(`${BASE}/portal/cases/${id}`, { headers: { cookie: sessionCookie('poc') } })).text();
expect('POC sees client comment', portal.includes('POD re-uploaded'), 'missing');
expect('POC never sees internal comment or note', !portal.includes('Rider under watch') && !portal.includes('SECRET-INTERNAL-NOTE'), 'leak!');
const P = 'app/portal/actions.ts';
r = await act('poc', `/portal/cases/${id}`, P, 'pocComment', { id, body: 'Thanks, checking' });
expect('POC sends a message', r.loc.includes('ok=Message sent'), r.loc);
const other = caseId('R10017139SFH');
r = await act('poc', `/portal/cases/${other}`, P, 'pocRequestLost', { id: other, reason: 'trying another client case' });
expect('POC cannot request Lost on another client', r.loc.includes('error=Case not found'), r.loc);
r = await act('poc', `/portal/cases/${id}`, P, 'pocRequestLost', { id, reason: 'Customer still has not received it' });
expect('POC requests Lost on own case', r.loc.includes('ok=Lost request sent') && sql(`select team_status from cases where id='${id}'`) === 'lost_pending_approval', r.loc);
expect('admins notified in-app', Number(sql(`select count(*) from notifications where type='lost_request'`)) >= 2, 'no notification');

// 5. Email: paste → review → create
const E = 'app/(internal)/email-escalations/actions.ts';
r = await act('agent', '/email-escalations/new?mode=paste', E, 'pasteEmail', { subject: 'Re: Regarding POD', from: 'Ritu <ritu@velocity.in>', date: '2026-10-02',
  body: 'Dear team,\nCustomer claims not received. Kindly share POD urgently.\n\nAWB\tHub\tDelivery Date\nR2470000001BDM\tDEL_KirtiNagar_RTS\t28-09-2026\nR2470000002BDM\tCJB_DC_FMRTS\t29-09-2026\n' });
const emailId = r.loc.match(/email-escalations\/([0-9a-f-]{36})/)?.[1];
expect('pasted email read', !!emailId && r.loc.includes('ok=Email read'), r.loc);
const ex = JSON.parse(sql(`select extraction from emails where id='${emailId}'`));
expect('tab-separated table parsed with hubs', ex.rows.length === 2 && ex.rows[0].hub === 'DEL_KirtiNagar_RTS' && ex.rows[0].location === 'Delhi', JSON.stringify(ex.rows));
expect('client from sender domain, priority and type found', ex.common.client_name === 'Velocity' && ex.common.priority === 'High' && ex.common.complaint_type === 'Fake delivery / not received', JSON.stringify(ex.common));
const payload = { common: { ...ex.common, client_poc_id: '', team_remark: 'Checking with hub', assigned_agent: '' }, rows: ex.rows.map((x) => ({ awb: x.awb, include: true, link_case_id: '', location: x.location ?? '', hub: x.hub ?? '', delivery_date: x.delivery_date ?? '', seller_name: '', reason: '', product_value: '', order_id: '', remark: '' })) };
r = await act('agent', `/email-escalations/${emailId}`, E, 'createFromEmail', { id: emailId, payload: JSON.stringify(payload) });
expect('cases created from email', r.loc.includes('ok=2 cases created from the email'), r.loc);
expect('email cases carry date and thread', sql(`select count(*) from cases where email_id='${emailId}' and escalation_date='2026-10-02' and source_type='email'`) === '2', 'wrong');

// 6. Admin configuration
const I = 'app/(internal)/imports/actions.ts';
const src = sql(`select id from sheet_sources where sheet_name='Sheet1'`);
r = await act('admin', `/imports/${src}`, I, 'saveMapping', { id: src, width: '3', col_0: 'client_name', auto_0: 'client_name', col_1: 'escalation_date', auto_1: 'escalation_date', col_2: 'product_value', auto_2: 'ignore' });
expect('mapping override saved', sql(`select column_map::text from sheet_sources where id='${src}'`) === '[{"index": 2, "target": "product_value"}]', sql(`select column_map from sheet_sources where id='${src}'`));
r = await act('agent', `/imports/${src}`, I, 'saveMapping', { id: src, width: '0' });
expect('agent cannot change mapping', r.loc.includes('Admin access needed'), r.loc);
r = await act('admin', '/imports/mappings', I, 'addStatusMapping', { pattern: 'Hold for review', match_type: 'exact', status_code: 'working_on_it', priority: '20' });
expect('status wording added', sql(`select status_code from status_mappings where pattern='hold for review'`) === 'working_on_it', r.loc);
const S = 'app/(internal)/settings/actions.ts';
r = await act('admin', '/settings', S, 'saveSettings', { 'setting:report_aging_order': 'desc', 'setting:report_recipients': 'santhoshkumar.m@shadowfax.in, naveed.iqbal@shadowfax.in, binay.sharma@shadowfax.in' });
expect('settings saved', sql(`select value #>> '{}' from app_settings where key='report_aging_order'`) === 'desc', r.loc);
r = await act('admin', '/settings', S, 'saveSettings', { 'setting:default_sla_days': 'abc' });
expect('invalid setting rejected', r.loc.includes('error=default_sla_days'), r.loc);
r = await act('admin', '/settings', S, 'saveBuckets', { buckets: '0-2\n5-7\n8+' });
expect('gapped buckets rejected', r.loc.includes('error='), r.loc);
r = await act('admin', '/settings', S, 'saveStatus', { code: 'awaiting_client', label: 'Awaiting client reply', category: 'open', color: 'blue', sort_order: '45', is_active: '1' });
expect('custom status added', sql(`select label from status_master where code='awaiting_client'`) === 'Awaiting client reply', r.loc);
const CL = 'app/(internal)/clients/actions.ts';
r = await act('admin', '/clients', CL, 'saveClient', { name: 'Meesho', aliases: 'Meesho Supply', email_domains: '@meesho.com', sla_days: '5' });
expect('client added', sql(`select email_domains::text from clients where name='Meesho'`) === '{meesho.com}', r.loc);
r = await act('admin', '/pocs', CL, 'savePoc', { client_id: sql(`select id from clients where name='Meesho'`), name: 'Priya', email: 'priya@meesho.com' });
expect('POC contact added', r.loc.includes('Priya saved'), r.loc);
r = await act('agent', '/cases', C, 'bulkUpdate', { ids: [caseId('R10017139SFH')], bulk_action: 'status', bulk_status: 'shipment_at_dc', back: '/cases' });
expect('bulk status change', sql(`select team_status from cases where awb='R10017139SFH'`) === 'shipment_at_dc', r.loc);

// 7. Crons are locked
let c = await fetch(`${BASE}/api/cron/sync-sheets`);
expect('cron without secret is rejected', c.status === 401, c.status);
c = await fetch(`${BASE}/api/cron/daily-report`, { headers: { authorization: 'Bearer test-cron-secret' } });
expect('daily report cron runs and logs failure without Gmail', c.status === 500 && sql(`select status from report_runs order by run_at desc limit 1`) === 'failed', c.status);

console.log(failures ? `\n${failures} FAILED` : '\nALL ACTION CHECKS PASSED');
process.exitCode = failures ? 1 : 0;
