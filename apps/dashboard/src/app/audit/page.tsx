import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mono, Table, Td } from '@/components/ui/Table';
import { type List, api } from '@/lib/api';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';
type Entry = { id: string; actor: string; action: string; subject: string; at: string };

export default async function Audit() {
  const log = await api<List<Entry>>('/v1/audit-log?limit=100');
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of every change: who, what and when."
      />
      {log.data.length === 0 ? (
        <EmptyState title="No entries yet" />
      ) : (
        <Table caption="Audit log" head={['When', 'Actor', 'Action', 'Subject']}>
          {log.data.map((e) => (
            <tr key={e.id}>
              <Td className="text-xs text-muted">{formatDate(e.at)}</Td>
              <Td>
                <Mono>{e.actor}</Mono>
              </Td>
              <Td>{e.action}</Td>
              <Td>
                <Mono>{e.subject}</Mono>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
