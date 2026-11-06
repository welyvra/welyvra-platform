#!/usr/bin/env node
import { connect } from '@welyvra/db';
import { runReconciliation } from './operations.js';

const [orgId] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url || !orgId) {
  console.error('usage: DATABASE_URL=... welyvra-reconcile <org-id>');
  process.exit(2);
}
const { sql, close } = connect(url, { max: 2 });
try {
  const run = await runReconciliation(sql, { orgId, actor: 'cli' });
  console.log(JSON.stringify(run, null, 2));
} finally {
  await close();
}
