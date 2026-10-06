// Stand-in for the Vercel CLI used by `npm run setup` tests: `deploy --prod --yes --token <t>`.
import { readFileSync, writeFileSync } from 'node:fs';

const STATE = process.env.MOCK_STATE;
const s = JSON.parse(readFileSync(STATE, 'utf8'));
const args = process.argv.slice(2);
if (args[0] !== 'deploy' || !args.includes('--prod') || args[args.indexOf('--token') + 1] !== 'vercel_test_token') {
  console.error('fake vercel: unexpected arguments', args);
  process.exit(2);
}
const p = s.projects[process.env.VERCEL_PROJECT_ID];
if (!p || process.env.VERCEL_ORG_ID !== p.accountId) {
  console.error('fake vercel: VERCEL_ORG_ID / VERCEL_PROJECT_ID not set to the project');
  process.exit(3);
}
const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'));
if (process.env.FAKE_HOBBY === '1' && cfg.crons.some((c) => c.schedule.includes('*/'))) {
  console.error('Error: Hobby accounts are limited to daily cron jobs. This cron expression would run more than once per day.');
  process.exit(1);
}
let leaked = [];
try {
  leaked = readFileSync('.vercelignore', 'utf8').includes('setup.env') ? [] : ['setup.env not ignored'];
} catch {
  leaked = ['.vercelignore missing'];
}
if (leaked.length) {
  console.error(leaked.join(', '));
  process.exit(4);
}
p.deployments++;
s.deploys = [...(s.deploys ?? []), { site: s.env[p.id]?.NEXT_PUBLIC_SITE_URL?.value, crons: cfg.crons.map((c) => c.schedule) }];
writeFileSync(STATE, JSON.stringify(s, null, 2));
console.log('Vercel CLI 99.0.0 (fake)');
console.log(`Production: https://${p.name}-abc123def-sfx.vercel.app [3s]`);
