// Loaded first by every script: .env.local wins over .env, like Next.js.
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });
