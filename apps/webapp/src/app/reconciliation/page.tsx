import Link from 'next/link';
import { RunReconciliationButton } from '@/components/Forms';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, Td } from '@/components/ui/Table';
import { type List, type Run, api } from '@/services/api';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';
const OUTCOMES = [
  'matched',
  'amount_mismatch',
  'customer_mismatch',
  'missing_internal',
  'missing_onchain',
] as const;

export default async function Reconciliation() {
  const runs = await api<List<Run>>('/v1/reconciliation-runs?limit=50');
  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="On-chain deposits compared with your internal records. Runs are deterministic and safe to repeat."
        action={<RunReconciliationButton />}
      />
      {runs.data.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="Send internal records (POST /v1/internal-records), then run a reconciliation."
        />
      ) : (
        <Table
          caption="Reconciliation runs"
          head={[
            'When',
            'By',
            'Matched',
            'Amount',
            'Customer',
            'Missing internal',
            'Missing on-chain',
          ]}
        >
          {runs.data.map((r) => (
            <tr key={r.id}>
              <Td>
                <Link href={`/reconciliation/${r.id}`} className="hover:text-iris">
                  {formatDate(r.created_at)}
                </Link>
              </Td>
              <Td className="text-xs text-muted">{r.actor}</Td>
              {OUTCOMES.map((o) => (
                <Td
                  key={o}
                  className={
                    o === 'matched'
                      ? 'tabular-nums text-mint'
                      : (r.summary[o] ?? 0) > 0
                        ? 'tabular-nums text-danger'
                        : 'tabular-nums text-muted'
                  }
                >
                  {r.summary[o] ?? 0}
                </Td>
              ))}
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
