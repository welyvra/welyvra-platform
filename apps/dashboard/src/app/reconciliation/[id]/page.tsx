import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Mono, Table, Td } from '@/components/ui/Table';
import { ApiError, type Run, api } from '@/lib/api';
import { formatDate, humanizeDetail, shortAddress } from '@/lib/format';

export const dynamic = 'force-dynamic';
type Detail = Run & {
  results: {
    outcome: string;
    deposit_id: string | null;
    internal_record_id: string | null;
    detail: string | null;
  }[];
};

export default async function RunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await api<Detail>(`/v1/reconciliation-runs/${encodeURIComponent(id)}`).catch((e) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  });
  return (
    <>
      <PageHeader
        title="Reconciliation run"
        description={`${formatDate(run.created_at)} · by ${run.actor}`}
      />
      <Table caption="Results" head={['Outcome', 'Deposit', 'Internal record', 'Detail']}>
        {run.results.map((r, i) => (
          <tr key={i}>
            <Td>
              <Badge variant={statusVariant(r.outcome)}>{r.outcome.replace('_', ' ')}</Badge>
            </Td>
            <Td>
              {r.deposit_id ? (
                <Mono>{shortAddress(r.deposit_id, 6)}</Mono>
              ) : (
                <span className="text-muted">—</span>
              )}
            </Td>
            <Td>
              {r.internal_record_id ? (
                <Mono>{shortAddress(r.internal_record_id, 6)}</Mono>
              ) : (
                <span className="text-muted">—</span>
              )}
            </Td>
            <Td className="text-xs text-muted">{r.detail ? humanizeDetail(r.detail) : ''}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
