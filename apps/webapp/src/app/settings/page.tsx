import { PageHeader } from '@/components/PageHeader';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Card, CardTitle } from '@/components/ui/Card';
import { Mono } from '@/components/ui/Table';
import { type List, type SyncStatus, api } from '@/services/api';
import { formatDate, shortAddress } from '@/lib/format';

export const dynamic = 'force-dynamic';
type Account = { id: string; network: string; address: string; label: string | null };

export default async function Settings() {
  const [accounts, sync] = await Promise.all([
    api<List<Account>>('/v1/receiving-accounts'),
    api<List<SyncStatus>>('/v1/sync-status'),
  ]);
  return (
    <>
      <PageHeader
        title="Settings"
        description="Receiving accounts and ingestion status. API keys and webhooks are managed through the API (admin role)."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Receiving accounts</CardTitle>
          {accounts.data.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              None yet. Register one with POST /v1/receiving-accounts.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {accounts.data.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3">
                  <span>
                    {a.label ?? 'Unnamed'} <span className="text-muted">· {a.network}</span>
                  </span>
                  <Mono title={a.address}>{shortAddress(a.address, 6)}</Mono>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Ingestion streams</CardTitle>
          {sync.data.length === 0 ? (
            <p className="mt-3 text-sm text-muted">The worker has not run yet.</p>
          ) : (
            <ul className="mt-3 space-y-3 text-sm">
              {sync.data.map((s) => (
                <li key={s.network + s.source}>
                  <div className="flex items-center justify-between gap-3">
                    <span>
                      {s.network} · {s.source}
                    </span>
                    <Badge variant={statusVariant(s.status)}>
                      {s.status === 'ok' ? 'in sync' : 'gap detected'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted">
                    Ledger {s.last_ledger} · updated {formatDate(s.updated_at)}
                  </p>
                  {s.status_detail && <p className="text-xs text-danger">{s.status_detail}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
