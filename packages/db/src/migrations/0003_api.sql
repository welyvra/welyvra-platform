-- API keys and webhooks (issue #9).

CREATE TYPE api_role AS ENUM ('admin', 'operator', 'viewer');
CREATE TYPE webhook_status AS ENUM ('pending', 'delivered', 'failed');

-- Only a SHA-256 hash of the secret is stored. The full key is shown once at creation.
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  prefix text NOT NULL UNIQUE CHECK (prefix ~ '^[a-z0-9]{12}$'),
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  role api_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- Signing secrets are stored encrypted (AES-256-GCM) with a key from the environment.
CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations (id),
  url text NOT NULL CHECK (length(url) <= 2048),
  secret_ciphertext text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)
);

-- Transactional outbox: rows are written in the same transaction as the change they announce.
CREATE TABLE webhook_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  endpoint_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status webhook_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  FOREIGN KEY (endpoint_id, org_id) REFERENCES webhook_endpoints (id, org_id)
);
CREATE INDEX webhook_outbox_due_idx ON webhook_outbox (next_attempt_at) WHERE status = 'pending';
