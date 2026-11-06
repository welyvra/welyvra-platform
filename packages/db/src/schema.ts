// Typed view of the SQL schema in ./migrations. The SQL files are the source of truth;
// keep this file in sync when adding a migration.
import {
  bigserial,
  customType,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** NUMERIC(39,0) mapped to bigint. Never a JS number. */
export const money = customType<{ data: bigint; driverData: string }>({
  dataType: () => 'numeric(39, 0)',
  toDriver: (v) => v.toString(),
  fromDriver: (v) => BigInt(v),
});

export const networkEnum = pgEnum('network', ['testnet', 'mainnet']);
export const routingKindEnum = pgEnum('routing_kind', ['id', 'text', 'hash']);
export const transferKindEnum = pgEnum('transfer_kind', ['transfer', 'mint']);
export const depositStatusEnum = pgEnum('deposit_status', ['attributed', 'unattributed']);
export const syncStatusEnum = pgEnum('sync_status', ['ok', 'gap_detected']);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const receivingAccounts = pgTable('receiving_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  network: networkEnum('network').notNull(),
  address: text('address').notNull(),
  label: text('label'),
  createdAt: createdAt(),
});

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  externalRef: text('external_ref').notNull(),
  name: text('name'),
  createdAt: createdAt(),
});

export const routingKeys = pgTable('routing_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  receivingAccountId: uuid('receiving_account_id').notNull(),
  kind: routingKindEnum('kind').notNull(),
  value: text('value').notNull(),
  customerId: uuid('customer_id').notNull(),
  createdAt: createdAt(),
});

export const chainEvents = pgTable('chain_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  network: networkEnum('network').notNull(),
  eventId: text('event_id').notNull(),
  ledger: integer('ledger').notNull(),
  ledgerClosedAt: timestamp('ledger_closed_at', { withTimezone: true }).notNull(),
  txHash: text('tx_hash').notNull(),
  txIndex: integer('tx_index').notNull(),
  opIndex: integer('op_index').notNull(),
  tokenContract: text('token_contract').notNull(),
  asset: text('asset'),
  kind: transferKindEnum('kind').notNull(),
  fromAddress: text('from_address'),
  toAddress: text('to_address').notNull(),
  routingKind: routingKindEnum('routing_kind'),
  routingValue: text('routing_value'),
  amount: money('amount').notNull(),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
});

export const chainEventRejections = pgTable('chain_event_rejections', {
  id: uuid('id').primaryKey().defaultRandom(),
  network: networkEnum('network').notNull(),
  eventId: text('event_id').notNull(),
  reason: text('reason').notNull(),
  raw: jsonb('raw').notNull(),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deposits = pgTable('deposits', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  chainEventId: uuid('chain_event_id').notNull(),
  receivingAccountId: uuid('receiving_account_id').notNull(),
  customerId: uuid('customer_id'),
  status: depositStatusEnum('status').notNull(),
  tokenContract: text('token_contract').notNull(),
  amount: money('amount').notNull(),
  createdAt: createdAt(),
});

export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  kind: text('kind').$type<'deposit' | 'reattribution' | 'adjustment'>().notNull(),
  sourceRef: text('source_ref').notNull(),
  memo: text('memo'),
  createdAt: createdAt(),
});

export const postings = pgTable('postings', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  entryId: uuid('entry_id').notNull(),
  orgId: uuid('org_id').notNull(),
  account: text('account').notNull(),
  asset: text('asset').notNull(),
  amount: money('amount').notNull(),
});

export const ingestionCursors = pgTable('ingestion_cursors', {
  network: networkEnum('network').notNull(),
  source: text('source').notNull(),
  lastLedger: integer('last_ledger').notNull(),
  lastCursor: text('last_cursor'),
  status: syncStatusEnum('status').notNull(),
  statusDetail: text('status_detail'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  orgId: uuid('org_id'),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  subject: text('subject').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
