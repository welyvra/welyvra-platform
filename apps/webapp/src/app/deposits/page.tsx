import { PageHeader } from '@/components/PageHeader';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mono, Table, Td } from '@/components/ui/Table';
import { type Customer, type Deposit, type List, api } from '@/services/api';
import { displayAmount, formatDate, shortAddress } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Deposits({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter = status === 'attributed' || status === 'unattributed' ? `&status=${status}` : '';
  const [deposits, customers] = await Promise.all([
    api<List<Deposit>>(`/v1/deposits?limit=100${filter}`),
    api<List<Customer>>('/v1/customers?limit=100'),
  ]);
  const names = new Map(customers.data.map((c) => [c.id, c.name ?? c.external_ref]));
  return (
    <>
      <PageHeader
        title="Deposits"
        description="Every deposit to your receiving accounts, newest first."
      />
      <nav aria-label="Filter" className="mb-4 flex gap-2 text-sm">
        {[
          ['All', ''],
          ['Attributed', 'attributed'],
          ['Unattributed', 'unattributed'],
        ].map(([label, value]) => (
          <a
            key={label}
            href={value ? `/deposits?status=${value}` : '/deposits'}
            aria-current={(status ?? '') === value ? 'page' : undefined}
            className="rounded-full border border-slate-2 px-3 py-1 text-muted aria-[current=page]:border-iris aria-[current=page]:text-white"
          >
            {label}
          </a>
        ))}
      </nav>
      {deposits.data.length === 0 ? (
        <EmptyState
          title="No deposits yet"
          description="Deposits appear here once the ingestion worker sees payments to a registered receiving account."
        />
      ) : (
        <Table
          caption="Deposits"
          head={['Status', 'Customer', 'Routing key', 'Amount', 'Transaction', 'Ledger time']}
        >
          {deposits.data.map((d) => (
            <tr key={d.id}>
              <Td>
                <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
              </Td>
              <Td>
                {d.customer_id ? (
                  (names.get(d.customer_id) ?? shortAddress(d.customer_id))
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Td>
              <Td>
                {d.routing_kind ? (
                  <Mono>{`${d.routing_kind}:${d.routing_value}`}</Mono>
                ) : (
                  <span className="text-muted">none</span>
                )}
              </Td>
              <Td className="text-right font-mono tabular-nums">{displayAmount(d.amount)}</Td>
              <Td>
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${d.tx_hash}`}
                  className="hover:text-iris"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <Mono title={d.tx_hash}>{shortAddress(d.tx_hash, 6)}</Mono>
                </a>
              </Td>
              <Td className="text-xs text-muted">{formatDate(d.ledger_closed_at)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
