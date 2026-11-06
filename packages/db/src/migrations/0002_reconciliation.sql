-- Internal records, reconciliation runs, exception cases (issue #8).

CREATE TYPE reconciliation_outcome AS ENUM ('matched', 'missing_internal', 'missing_onchain', 'amount_mismatch', 'customer_mismatch');
CREATE TYPE case_kind AS ENUM ('unattributed_deposit', 'missing_internal', 'missing_onchain', 'amount_mismatch', 'customer_mismatch');
CREATE TYPE case_status AS ENUM ('open', 'investigating', 'resolved', 'dismissed');

-- What the business says it received. Idempotent by (org_id, external_id).
CREATE TABLE internal_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  customer_id uuid,
  token_contract text NOT NULL,
  amount numeric(39, 0) NOT NULL CHECK (amount > 0),
  tx_hash text CHECK (tx_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, external_id),
  UNIQUE (id, org_id),
  FOREIGN KEY (customer_id, org_id) REFERENCES customers (id, org_id)
);
CREATE TRIGGER internal_records_append_only BEFORE UPDATE OR DELETE ON internal_records
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TABLE reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id),
  actor text NOT NULL,
  summary jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);

CREATE TABLE reconciliation_results (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL,
  org_id uuid NOT NULL,
  outcome reconciliation_outcome NOT NULL,
  deposit_id uuid,
  internal_record_id uuid,
  detail text,
  FOREIGN KEY (run_id, org_id) REFERENCES reconciliation_runs (id, org_id),
  FOREIGN KEY (deposit_id, org_id) REFERENCES deposits (id, org_id),
  FOREIGN KEY (internal_record_id, org_id) REFERENCES internal_records (id, org_id),
  CHECK (deposit_id IS NOT NULL OR internal_record_id IS NOT NULL)
);
CREATE TRIGGER reconciliation_results_append_only BEFORE UPDATE OR DELETE ON reconciliation_results
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- One case per (kind, subject) ever: re-running reconciliation never duplicates cases,
-- and a dismissed case is not reopened by the next run.
CREATE TABLE exception_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id),
  kind case_kind NOT NULL,
  status case_status NOT NULL DEFAULT 'open',
  subject_ref text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, kind, subject_ref),
  UNIQUE (id, org_id)
);
CREATE INDEX exception_cases_open_idx ON exception_cases (org_id, status);

CREATE TABLE case_events (
  id bigserial PRIMARY KEY,
  case_id uuid NOT NULL,
  org_id uuid NOT NULL,
  actor text NOT NULL,
  from_status case_status,
  to_status case_status NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, org_id) REFERENCES exception_cases (id, org_id)
);
CREATE TRIGGER case_events_append_only BEFORE UPDATE OR DELETE ON case_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

-- Case status changes must follow the state machine, whatever code path writes them.
CREATE FUNCTION check_case_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF (OLD.status = 'open' AND NEW.status IN ('investigating', 'resolved', 'dismissed'))
     OR (OLD.status = 'investigating' AND NEW.status IN ('resolved', 'dismissed')) THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid case transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER exception_cases_transition BEFORE UPDATE ON exception_cases
  FOR EACH ROW EXECUTE FUNCTION check_case_transition();
CREATE TRIGGER exception_cases_no_delete BEFORE DELETE ON exception_cases
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
