/**
 * Sync Google Sheet tabs from the command line — useful for the first big import, which can take
 * longer than a serverless function is allowed to run.
 *   npm run sync:sheets              (all active tabs)
 *   npm run sync:sheets -- <id> ...  (specific sheet_sources ids)
 */
import './_env';
import { syncSources } from '../src/lib/importer/sheets-sync';
import { createAdminClient } from '../src/lib/supabase/admin';

async function main() {
  const ids = process.argv.slice(2);
  const { results, remaining } = await syncSources(createAdminClient(), {
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
