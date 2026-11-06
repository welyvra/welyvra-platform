import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, Td } from '@/components/ui/Table';
import { type Case, type List, api } from '@/lib/api';
import { CASE_LABELS, formatDate, humanizeDetail } from '@/lib/format';

export const dynamic = 'force-dynamic';
const STATUSES = ['open', 'investigating', 'resolved', 'dismissed'];

export default async function Cases({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const valid = status && STATUSES.includes(status) ? status : undefined;
  const cases = await api<List<Case>>(`/v1/cases?limit=100${valid ? `&status=${valid}` : ''}`);
  return (
    <>
      <PageHeader
        title="Exception cases"
        description="Unattributed deposits and reconciliation discrepancies. Every change is recorded with who, when and why."
      />
      <nav aria-label="Filter" className="mb-4 flex flex-wrap gap-2 text-sm">
        {['all', ...STATUSES].map((s) => (
          <a
            key={s}
            href={s === 'all' ? '/cases' : `/cases?status=${s}`}
            aria-current={(valid ?? 'all') === s ? 'page' : undefined}
            className="rounded-full border border-slate-2 px-3 py-1 capitalize text-muted aria-[current=page]:border-iris aria-[current=page]:text-white"
          >
            {s}
          </a>
        ))}
      </nav>
      {cases.data.length === 0 ? (
        <EmptyState title="No cases" description="Nothing needs attention with this filter." />
      ) : (
        <Table caption="Exception cases" head={['Case', 'Status', 'Detail', 'Opened', 'Updated']}>
          {cases.data.map((c) => (
            <tr key={c.id}>
              <Td>
                <Link href={`/cases/${c.id}`} className="hover:text-iris">
                  {CASE_LABELS[c.kind] ?? c.kind}
                </Link>
              </Td>
              <Td>
                <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
              </Td>
              <Td className="text-xs text-muted">{c.detail ? humanizeDetail(c.detail) : ''}</Td>
              <Td className="text-xs text-muted">{formatDate(c.created_at)}</Td>
              <Td className="text-xs text-muted">{formatDate(c.updated_at)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
