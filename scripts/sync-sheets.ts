/**
 * Sync Google Sheet tabs from the command line — useful for the first big import, which can take
 * longer than a serverless function is allowed to run.
 *   npm run sync:sheets              (all active tabs)
 *   npm run sync:sheets -- <id> ...  (specific sheet_sources ids)
 *   npm run sync:sheets -- --pods    (only the POD sheets; add --full to read them again from the top)
 */
import './_env';
import { syncSources } from '../src/lib/importer/sheets-sync';
import { syncPodIndex } from '../src/lib/pod/sheets';
import { createAdminClient } from '../src/lib/supabase/admin';

async function main() {
  const args = process.argv.slice(2);
  const ids = args.filter((a) => !a.startsWith('--'));
  const sb = createAdminClient();
  if (!args.includes('--pods')) await trackers(sb, ids);
  if (!ids.length) {
    console.log('POD sheets (read only):');
    for (const r of await syncPodIndex(sb, { deadline: Date.now() + 6 * 60 * 60 * 1000, full: args.includes('--full') })) {
      console.log(`  ${r.workbook} › ${r.tab}: ${r.message}${r.links ? ` (${r.links} AWB links)` : ''}`);
    }
  }
}

async function trackers(sb: ReturnType<typeof createAdminClient>, ids: string[]) {
  const { results, remaining } = await syncSources(sb, {
    actor: null, trigger: 'cli', sourceIds: ids.length ? ids : undefined, timeBudgetMs: 6 * 60 * 60 * 1000,
  });
  for (const r of results) {
    console.log(`${r.status.padEnd(8)} ${r.label}\n         ${r.message} (rows ${r.rowsRead}, lost requests ${r.lostRequests})`);
  }
  if (remaining) console.log(`${remaining} tab(s) not reached.`);
  if (results.some((r) => r.status === 'failed')) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
