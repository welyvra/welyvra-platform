-- Welyvra initial schema. Invariants: docs/architecture/data-model.md.
-- Money is NUMERIC(39,0) in the asset's smallest unit (i128 range).

CREATE TYPE network AS ENUM ('testnet', 'mainnet');
CREATE TYPE routing_kind AS ENUM ('id', 'text', 'hash');
CREATE TYPE transfer_kind AS ENUM ('transfer', 'mint');
CREATE TYPE deposit_status AS ENUM ('attributed', 'unattributed');
CREATE TYPE sync_status AS ENUM ('ok', 'gap_detected');

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE receiving_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id),
  network network NOT NULL,
  address text NOT NULL CHECK (address ~ '^[GC][A-Z2-7]{55}$'),
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network, address),
  UNIQUE (id, org_id)
);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id),
  external_ref text NOT NULL CHECK (length(external_ref) BETWEEN 1 AND 200),
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, external_ref),
  UNIQUE (id, org_id)
);

-- Composite foreign keys make cross-tenant references impossible.
CREATE TABLE routing_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  receiving_account_id uuid NOT NULL,
  kind routing_kind NOT NULL,
  value text NOT NULL CHECK (
    (kind = 'id' AND value ~ '^(0|[1-9][0-9]{0,19})$' AND value::numeric <= 18446744073709551615)
    OR (kind = 'text' AND length(value) BETWEEN 1 AND 28)
    OR (kind = 'hash' AND value ~ '^[0-9a-f]{64}$')
  ),
  customer_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receiving_account_id, kind, value),
  FOREIGN KEY (receiving_account_id, org_id) REFERENCES receiving_accounts (id, org_id),
  FOREIGN KEY (customer_id, org_id) REFERENCES customers (id, org_id)
);

-- Chain data. Global (not per tenant): one event may matter to the account that owns its destination.
CREATE TABLE chain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network network NOT NULL,
  event_id text NOT NULL CHECK (event_id ~ '^[0-9]{19}-[0-9]{10}$'),
  ledger integer NOT NULL CHECK (ledger > 0),
  ledger_closed_at timestamptz NOT NULL,
  tx_hash text NOT NULL CHECK (tx_hash ~ '^[0-9a-f]{64}$'),
  tx_index integer NOT NULL,
  op_index integer NOT NULL,
  token_contract text NOT NULL,
  asset text,
  kind transfer_kind NOT NULL,
  from_address text,
  to_address text NOT NULL,
  routing_kind routing_kind,
  routing_value text,
  amount numeric(39, 0) NOT NULL CHECK (amount > 0 AND amount <= 170141183460469231731687303715884105727),
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network, event_id),
  CHECK ((routing_kind IS NULL) = (routing_value IS NULL))
);
CREATE INDEX chain_events_to_idx ON chain_events (network, to_address, ledger);

-- Events that could not be decoded. Kept, never dropped, so they can be investigated.
CREATE TABLE chain_event_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network network NOT NULL,
  event_id text NOT NULL,
  reason text NOT NULL,
  raw jsonb NOT NULL,
  rejected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network, event_id)
);

CREATE TABLE deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  chain_event_id uuid NOT NULL REFERENCES chain_events (id),
  receiving_account_id uuid NOT NULL,
  customer_id uuid,
  status deposit_status NOT NULL,
  token_contract text NOT NULL,
  amount numeric(39, 0) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_event_id, receiving_account_id),
  UNIQUE (id, org_id),
  FOREIGN KEY (receiving_account_id, org_id) REFERENCES receiving_accounts (id, org_id),
  FOREIGN KEY (customer_id, org_id) REFERENCES customers (id, org_id),
  CHECK ((status = 'attributed') = (customer_id IS NOT NULL))
);
CREATE INDEX deposits_org_idx ON deposits (org_id, created_at);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id),
  kind text NOT NULL CHECK (kind IN ('deposit', 'reattribution', 'adjustment')),
  source_ref text NOT NULL,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, kind, source_ref),
  UNIQUE (id, org_id)
);

CREATE TABLE postings (
  id bigserial PRIMARY KEY,
  entry_id uuid NOT NULL,
  org_id uuid NOT NULL,
  account text NOT NULL CHECK (account ~ '^(onchain|customer|unattributed|adjustment):[0-9a-f-]{36}$'),
  asset text NOT NULL,
  amount numeric(39, 0) NOT NULL CHECK (amount <> 0),
  FOREIGN KEY (entry_id, org_id) REFERENCES journal_entries (id, org_id)
);
CREATE INDEX postings_account_idx ON postings (org_id, account, asset);

CREATE TABLE ingestion_cursors (
  network network NOT NULL,
  source text NOT NULL,
  last_ledger integer NOT NULL CHECK (last_ledger >= 0),
  last_cursor text,
  status sync_status NOT NULL DEFAULT 'ok',
  status_detail text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, source)
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  org_id uuid REFERENCES organizations (id),
  actor text NOT NULL,
  action text NOT NULL,
  subject text NOT NULL,
  before jsonb,
  after jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_idx ON audit_log (org_id, at);

-- Append-only tables: reject UPDATE and DELETE for every role, including the owner.
CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER chain_events_append_only BEFORE UPDATE OR DELETE ON chain_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER chain_event_rejections_append_only BEFORE UPDATE OR DELETE ON chain_event_rejections
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER postings_append_only BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER no_truncate_postings BEFORE TRUNCATE ON postings
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER no_truncate_journal BEFORE TRUNCATE ON journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- Every journal entry must balance per asset and have at least two postings.
-- Deferred to commit so all postings of an entry are inserted first.
CREATE FUNCTION check_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  unbalanced int;
  n int;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN target := NEW.id; ELSE target := NEW.entry_id; END IF;
  SELECT count(*) INTO n FROM postings WHERE entry_id = target;
  IF n < 2 THEN
    RAISE EXCEPTION 'journal entry % has % postings (min 2)', target, n USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO unbalanced FROM (
    SELECT asset FROM postings WHERE entry_id = target GROUP BY asset HAVING sum(amount) <> 0
  ) s;
  IF unbalanced > 0 THEN
    RAISE EXCEPTION 'journal entry % is not balanced', target USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER postings_balanced AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();
CREATE CONSTRAINT TRIGGER journal_entries_have_postings AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();
