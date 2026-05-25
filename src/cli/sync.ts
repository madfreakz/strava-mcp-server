import * as dotenv from 'dotenv';
dotenv.config();

import { syncCli } from '../tools/obsidian';

syncCli().catch(err => {
  process.stderr.write(`Sync failed: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
