export type CaseStatus = 'open' | 'investigating' | 'resolved' | 'dismissed';
export type CaseKind =
  | 'unattributed_deposit'
  | 'missing_internal'
  | 'missing_onchain'
  | 'amount_mismatch'
  | 'customer_mismatch';

const ALLOWED: Record<CaseStatus, readonly CaseStatus[]> = {
  open: ['investigating', 'resolved', 'dismissed'],
  investigating: ['resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: CaseStatus, to: CaseStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: CaseStatus,
    readonly to: CaseStatus,
  ) {
    super(`invalid case transition ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}
