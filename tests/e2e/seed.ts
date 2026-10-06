// Loads realistic data through the real import / email / approval paths (no Google needed).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadImportConfig } from '../../src/lib/importer/config';
import { getSource, normalizeFor } from '../../src/lib/importer/sheets-sync';
import { importPastedEmail } from '../../src/lib/email/import';
// @ts-expect-error plain JS helper
import { ANON, SERVICE, tokenFor } from './jwt.mjs';

const URL = 'http://localhost:54321';
const as = (token: string): SupabaseClient =>
  createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
const must = <T,>(r: { data: T; error: unknown }) => {
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.data;
};

async function main() {
  const admin = as(SERVICE);
  const cfg = await loadImportConfig(admin);
  const sources = must(await admin.from('sheet_sources').select('id, sheet_name, workbook_name')) as { id: string; sheet_name: string; workbook_name: string }[];
  const src = (wb: string, tab: string) => sources.find((s) => s.workbook_name.startsWith(wb) && s.sheet_name === tab)!.id;
  const d = (n: number) => {
    const t = new Date(Date.now() - n * 86400000);
    return `${t.getUTCDate()}-${t.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}-${t.getUTCFullYear()}`;
  };

  // Velocity tracker (header on row 2, typos, #REF!, POD shared / LOST wording)
  const velocity = [
    [],
    ['Client name', 'Esc Date', 'AEGING', 'AWB', 'Delivery date', 'Seller name', 'Hub', 'POD links', 'SFX remark', 'Remark', 'Mail subject', 'price'],
    ['Velocity', d(40), '#REF!', 'R2111303762VEO', '02-06-2026 17:11', 'Warrior World', 'ST_Godadara_RTS', 'https://drive.google.com/file/d/1Rz/view', 'POD shared', '', 'Re: Urgent – Incorrect Shipment Status / POD Request', '1299'],
    ['Velocity', d(18), '76', ' sf3583535088veo', '10-07-2026 14:24', 'Eitheo (Kirti Nagar)', 'DEL_KirtiNagar_RTS', 'will share tomorrow', 'working on it', '', '', '24999'],
    ['Velocity', d(9), '', 'R2178493750VEO', '25-06-2026 12:09', 'Warrior World', 'ST_Godadara_RTS', '', 'LOST', 'Need LOST ASAP', '', '8999'],
    ['Velocity', d(3), '', 'R2200974986VEO', '01-07-2026 12:18', 'Warrior World', 'BLR_Hosur_RTS', '', 'Hold for review', '', '', '650'],
    ['Velocity', d(1), '', 'R2131834705VEO', '', 'Acme', 'PWL_Palwal_FM', '', '', '', '', ''],
    ['Velocity', '', '', 'R2131834799VEO', '', 'Acme', 'PWL_Palwal_FM', '', '', '', 'POD needed - Shadowfax - 11-09-26', ''],
  ];
  const kart = [
    ['Esc Date', 'AWB', 'Delivery date', 'POC', 'Agent', 'Status', 'Client reamrks'],
    ['7/1/2026', 'R10017137SFH', '28-06-2026', 'Sanjeev D', 'Assem', 'closed', ''],
    ['7/13/2026', 'R10017138SFH', '10-07-2026', 'Sanjeev D', 'Assem', 'POD shared', 'ok'],
    ['9/20/2026', 'R10017139SFH', '15-09-2026', 'Sanjeev D', 'Assem', 'working on it', ''],
  ];
  for (const [id, values] of [[src('Velocity', 'Sheet1'), velocity], [src('Kartrocket', 'Sanjeev D - From July'), kart]] as const) {
    const source = (await getSource(admin, id))!;
    const n = normalizeFor(values as string[][], source, cfg);
    const r = must(await admin.rpc('import_sheet_rows', { p_source_id: id, p_rows: n.rows, p_actor: null }));
    console.log(source.sheet_name, JSON.stringify(r));
    await admin.from('sheet_sources').update({ last_synced_at: new Date().toISOString(), last_sync_status: 'success', last_sync_message: 'Seeded locally', last_row_count: n.rows.length }).eq('id', id);
  }

  // Email escalation from the spec, read by an agent
  const agent = as(tokenFor('agent'));
  const emailId = await importPastedEmail(agent, {
    subject: 'POD needed - Shadowfax - 11-09-26', from: 'Ops <ops@velocity.in>', date: new Date().toISOString(),
    body: 'Hi Team,\n\nPlease provide POD\n\nAWB | WH\nR2466544662BDM | Bangalore\nR2460991811BDM | Jaipur\n\nRegards,\nOps',
  }, '00000000-0000-0000-0000-000000000003');
  const email = must(await agent.from('emails').select('extraction').eq('id', emailId).single()) as { extraction: any };
  const x = email.extraction;
  console.log('email extraction', x.rows.map((r: any) => `${r.awb}/${r.location}`).join(', '), x.common.client_name, x.common.reason);
  const created = must(await agent.rpc('create_email_cases', {
    p_email_id: emailId, p_common: { ...x.common, assigned_agent: '00000000-0000-0000-0000-000000000003' },
    p_rows: x.rows.map((r: any) => ({ ...r, delivery_date: r.delivery_date ?? '' })),
  }));
  console.log('email cases', JSON.stringify(created));
  // A second email left for review
  await importPastedEmail(agent, { subject: 'Regarding POD', from: 'someone@unknown.com', date: new Date().toISOString(), body: 'Hello,\nkindly check R10017140SFH asap\nThanks' }, '00000000-0000-0000-0000-000000000003');

  // POC requests Lost on a Velocity case; admin approves one request
  const poc = as(tokenFor('poc'));
  const pocCase = must(await poc.from('v_cases').select('id').eq('awb', 'R2200974986VEO').single()) as { id: string };
  must(await poc.rpc('request_lost', { p_case_id: pocCase.id, p_reason: 'Customer says never delivered; hub cannot trace' }));
  const adminUser = as(tokenFor('admin'));
  const sheetReq = must(await adminUser.from('lost_approvals').select('id, cases(awb)').eq('status', 'pending')) as any[];
  const toApprove = sheetReq.find((a) => a.cases.awb === 'R2178493750VEO');
  must(await adminUser.rpc('decide_lost', { p_approval_id: toApprove.id, p_decision: 'approved', p_note: 'Hub confirmed untraceable' }));
  const otherClient = as(tokenFor('poc2'));
  const leak = must(await otherClient.from('v_cases').select('id')) as unknown[];
  console.log('Naaptol POC sees', leak.length, 'cases (expected 0)');
  const stats = must(await adminUser.rpc('case_stats', {})) as any;
  console.log('stats', JSON.stringify({ total: stats.total, open: stats.open, by_status: stats.by_status.filter((s: any) => s.count).map((s: any) => `${s.code}:${s.count}`) }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
