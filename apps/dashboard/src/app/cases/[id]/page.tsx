import { notFound } from 'next/navigation';
import { AttributeForm, TransitionForm } from '@/components/Forms';
import { PageHeader } from '@/components/PageHeader';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { Mono } from '@/components/ui/Table';
import { ApiError, type Case, type Customer, type Deposit, type List, api } from '@/lib/api';
import { CASE_LABELS, displayAmount, formatDate, humanizeDetail, shortAddress } from '@/lib/format';

export const dynamic = 'force-dynamic';
type Detail = Case & {
  events: {
    actor: string;
    from_status: string | null;
    to_status: string;
    reason: string;
    at: string;
  }[];
};
const NEXT: Record<string, string[]> = {
  open: ['investigating', 'resolved', 'dismissed'],
  investigating: ['resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
};

export default async function CaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await api<Detail>(`/v1/cases/${encodeURIComponent(id)}`).catch((e) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  });
  const depositId = /^deposit:([0-9a-f-]{36})/.exec(c.subject_ref)?.[1];
  const [deposit, customers] = await Promise.all([
    depositId ? api<Deposit>(`/v1/deposits/${depositId}`).catch(() => null) : null,
    c.kind === 'unattributed_deposit' ? api<List<Customer>>('/v1/customers?limit=100') : null,
  ]);
  const canAttribute =
    c.kind === 'unattributed_deposit' && deposit?.status === 'unattributed' && customers;

  return (
    <>
      <PageHeader
        title={CASE_LABELS[c.kind] ?? c.kind}
        description={`Opened ${formatDate(c.created_at)}`}
        action={<Badge variant={statusVariant(c.status)}>{c.status}</Badge>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {deposit && (
            <Card>
              <CardTitle>Deposit</CardTitle>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Amount</dt>
                <dd className="font-mono tabular-nums">{displayAmount(deposit.amount)}</dd>
                <dt className="text-muted">Routing key</dt>
                <dd>
                  {deposit.routing_kind ? (
                    <Mono>{`${deposit.routing_kind}:${deposit.routing_value}`}</Mono>
                  ) : (
                    'none'
                  )}
                </dd>
                <dt className="text-muted">From</dt>
                <dd>
                  {deposit.from_address ? (
                    <Mono title={deposit.from_address}>
                      {shortAddress(deposit.from_address, 6)}
                    </Mono>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt className="text-muted">Transaction</dt>
                <dd>
                  <Mono title={deposit.tx_hash}>{shortAddress(deposit.tx_hash, 8)}</Mono>
                </dd>
              </dl>
            </Card>
          )}
          {c.detail && (
            <Card>
              <CardTitle>Detail</CardTitle>
              <p className="mt-2 text-sm text-muted">{humanizeDetail(c.detail)}</p>
            </Card>
          )}
          <Card>
            <CardTitle>History</CardTitle>
            <ol className="mt-3 space-y-3">
              {c.events.map((e, i) => (
                <li key={i} className="border-l-2 border-slate-2 pl-3 text-sm">
                  <p>
                    {e.from_status ? `${e.from_status} → ` : ''}
                    <span className="font-medium">{e.to_status}</span>{' '}
                    <span className="text-muted">by {e.actor}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {formatDate(e.at)} · {e.reason}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-4">
          {canAttribute && depositId && (
            <Card>
              <CardTitle>Attribute to a customer</CardTitle>
              <p className="mb-3 mt-1 text-xs text-muted">
                Creates a new ledger entry and resolves this case. Nothing existing is edited.
              </p>
              <AttributeForm
                depositId={depositId}
                customers={customers.data.map((x) => ({
                  id: x.id,
                  label: x.name ?? x.external_ref,
                }))}
              />
            </Card>
          )}
          <Card>
            <CardTitle>Change status</CardTitle>
            <div className="mt-3">
              <TransitionForm caseId={c.id} options={NEXT[c.status] ?? []} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
