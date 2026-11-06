#!/usr/bin/env node
// Bootstrap helper: creates an organization and its first admin API key. The key is printed once.
import { connect, migrate, one } from '@welyvra/db';
import { generateApiKey } from './security.js';

const [cmd, ...args] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url || cmd !== 'create-org' || !args[0]) {
  console.error('usage: DATABASE_URL=... welyvra-admin create-org "<name>"');
  process.exit(2);
}
const { sql, close } = connect(url, { max: 1 });
try {
  await migrate(sql);
  const org = one(
    await sql<
      { id: string }[]
    >`INSERT INTO organizations (name) VALUES (${args.join(' ')}) RETURNING id`,
  );
  const k = generateApiKey();
  await sql`INSERT INTO api_keys (org_id, name, prefix, secret_hash, role) VALUES (${org.id}, 'bootstrap admin', ${k.prefix}, ${k.secretHash}, 'admin')`;
  await sql`INSERT INTO audit_log (org_id, actor, action, subject) VALUES (${org.id}, 'cli', 'organization.create', ${'org:' + org.id})`;
  console.log(
    JSON.stringify(
      { org_id: org.id, admin_api_key: k.key, note: 'Store this key now. It is not shown again.' },
      null,
      2,
    ),
  );
} finally {
  await close();
}
