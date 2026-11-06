'use client';
import { useActionState } from 'react';
import {
  type ActionState,
  attributeDeposit,
  runReconciliation,
  transitionCase,
} from '@/app/actions';
import { Button } from './ui/Button';

function Feedback({ state }: { state: ActionState }) {
  if (state.error)
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p role="status" className="text-sm text-mint">
        {state.ok}
      </p>
    );
  return null;
}

const field =
  'w-full rounded-lg border border-slate-2 bg-midnight px-3 py-2 text-sm text-white placeholder:text-muted';

export function RunReconciliationButton() {
  const [state, action, pending] = useActionState(runReconciliation, {});
  return (
    <form action={action} className="flex items-center gap-3">
      <Button disabled={pending}>{pending ? 'Running…' : 'Run reconciliation'}</Button>
      <Feedback state={state} />
    </form>
  );
}

export function AttributeForm({
  depositId,
  customers,
}: {
  depositId: string;
  customers: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(attributeDeposit, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="depositId" value={depositId} />
      <div>
        <label htmlFor="customerId" className="mb-1 block text-xs text-muted">
          Customer
        </label>
        <select id="customerId" name="customerId" required className={field}>
          <option value="">Select a customer</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="attr-reason" className="mb-1 block text-xs text-muted">
          Reason (recorded in the audit log)
        </label>
        <input
          id="attr-reason"
          name="reason"
          required
          minLength={3}
          className={field}
          placeholder="e.g. customer sent the receipt"
        />
      </div>
      <Button disabled={pending}>Attribute deposit</Button>
      <Feedback state={state} />
    </form>
  );
}

export function TransitionForm({ caseId, options }: { caseId: string; options: string[] }) {
  const [state, action, pending] = useActionState(transitionCase, {});
  if (options.length === 0) return <p className="text-sm text-muted">This case is closed.</p>;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="caseId" value={caseId} />
      <div>
        <label htmlFor="to" className="mb-1 block text-xs text-muted">
          New status
        </label>
        <select id="to" name="to" required className={field}>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="case-reason" className="mb-1 block text-xs text-muted">
          Reason
        </label>
        <input id="case-reason" name="reason" required minLength={3} className={field} />
      </div>
      <Button variant="secondary" disabled={pending}>
        Update case
      </Button>
      <Feedback state={state} />
    </form>
  );
}
