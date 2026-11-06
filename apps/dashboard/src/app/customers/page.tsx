import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mono, Table, Td } from '@/components/ui/Table';
import { type Customer, type List, api } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function Customers() {
  const customers = await api<List<Customer>>('/v1/customers?limit=100');
  return (
    <>
      <PageHeader
        title="Customers"
        description="Customers and the routing keys (memo, M or W muxed ID) that identify their deposits."
      />
      {customers.data.length === 0 ? (
        <EmptyState
          title="No customers yet"
          description="Create customers and routing keys through the API (POST /v1/customers)."
        />
      ) : (
        <Table caption="Customers" head={['Reference', 'Name', 'Routing keys']}>
          {customers.data.map((c) => (
            <tr key={c.id}>
              <Td>{c.external_ref}</Td>
              <Td>{c.name ?? <span className="text-muted">—</span>}</Td>
              <Td>
                {c.routing_keys.length === 0 ? (
                  <span className="text-muted">none</span>
                ) : (
                  <span className="flex flex-wrap gap-2">
                    {c.routing_keys.map((k) => (
                      <Mono
                        key={`${k.receiving_account_id}${k.kind}${k.value}`}
                      >{`${k.kind}:${k.value}`}</Mono>
                    ))}
                  </span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
