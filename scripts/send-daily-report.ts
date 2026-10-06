/**
 * Send (or preview) the daily admin report.
 *   npm run report:send                       → configured recipients
 *   npm run report:send -- me@shadowfax.in    → only these addresses
 *   npm run report:send -- --preview          → writes report-preview.html and the .xlsx locally, sends nothing
 */
import './_env';
import { writeFileSync } from 'node:fs';
import { buildDailyReport, sendDailyReport } from '../src/lib/reports/daily';
import { createAdminClient } from '../src/lib/supabase/admin';

async function main() {
  const args = process.argv.slice(2);
  const sb = createAdminClient();
  if (args.includes('--preview')) {
    const r = await buildDailyReport(sb, { withAttachment: true });
    writeFileSync('report-preview.html', r.html);
    writeFileSync(r.filename, r.xlsx!);
    console.log(`Wrote report-preview.html and ${r.filename}. Would send to: ${r.recipients.join(', ')}`);
    return;
  }
  const to = args.filter((a) => a.includes('@'));
  const r = await sendDailyReport(sb, { trigger: 'cli', to: to.length ? to : undefined });
  console.log(`Sent to ${r.recipients.join(', ')} (Gmail id ${r.messageId})`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
