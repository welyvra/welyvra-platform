// Response shapes of the Welyvra API (see docs/api/openapi.json). Amounts are integer strings.
export interface Deposit {
  id: string;
  status: 'attributed' | 'unattributed';
  customer_id: string | null;
  receiving_account_id: string;
  token_contract: string;
  amount: string;
  event_id: string;
  tx_hash: string;
  ledger: number;
  ledger_closed_at: string;
  from_address: string | null;
  routing_kind: string | null;
  routing_value: string | null;
}
export interface Customer {
  id: string;
  external_ref: string;
  name: string | null;
  routing_keys: { receiving_account_id: string; kind: string; value: string }[];
}
export interface Case {
  id: string;
  kind: string;
  status: 'open' | 'investigating' | 'resolved' | 'dismissed';
  subject_ref: string;
  detail: string | null;
  created_at: string;
  updated_at: string;
}
export interface Run {
  id: string;
  actor: string;
  summary: Record<string, number>;
  created_at: string;
}
export interface SyncStatus {
  network: string;
  source: string;
  last_ledger: number;
  status: 'ok' | 'gap_detected';
  status_detail: string | null;
  updated_at: string;
}
export type List<T> = { data: T[] };
