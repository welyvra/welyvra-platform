import Link from 'next/link';
import { RunReconciliationButton } from '@/components/Forms';
import { PageHeader } from '@/components/PageHeader';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Card, CardTitle, Stat } from '@/components/ui/Card';
import { type Case, type Deposit, type List, type Run, type SyncStatus, api } from '@/services/api';
import { CASE_LABELS, formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Overview() {
  const [deposits, unattributed, cases, runs, sync] = await Promise.all([
    api<List<Deposit>>('/v1/deposits?limit=100'),
    api<List<Deposit>>('/v1/deposits?status=unattributed&limit=100'),
    api<List<Case>>('/v1/cases?status=open&limit=100'),
    api<List<Run>>('/v1/reconciliation-runs?limit=1'),
    api<List<SyncStatus>>('/v1/sync-status'),
  ]);
  const lastRun = runs.data[0];
  return (
    <>
      <PageHeader
        title="Overview"
        description="Where deposits, records and exceptions stand right now."
        action={<RunReconciliationButton />}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Recent deposits" value={deposits.data.length} hint="last 100" />
        <Stat label="Unattributed" value={unattributed.data.length} hint="need a customer" />
        <Stat label="Open cases" value={cases.data.length} />
        <Stat
          label="Last reconciliation"
          value={lastRun ? `${lastRun.summary.matched ?? 0} matched` : 'never'}
          hint={lastRun ? formatDate(lastRun.created_at) : undefined}
        />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Ingestion</CardTitle>
          {sync.data.length === 0 ? (
            <p className="mt-3 text-sm text-muted">The ingestion worker has not run yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {sync.data.map((s) => (
                <li
                  key={s.network + s.source}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span>
                    {s.network} · {s.source} · ledger{' '}
                    <span className="font-mono">{s.last_ledger}</span>
                  </span>
                  <Badge variant={statusVariant(s.status)}>
                    {s.status === 'ok' ? 'in sync' : 'gap detected'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Open cases</CardTitle>
          {cases.data.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No open cases.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {cases.data.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/cases/${c.id}`}
                    className="flex items-center justify-between gap-3 text-sm hover:text-iris"
                  >
                    {CASE_LABELS[c.kind] ?? c.kind}
                    <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
