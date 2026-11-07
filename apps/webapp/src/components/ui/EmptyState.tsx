// Adapted from Akkuea (MIT, Copyright (c) Acachete Labs), apps/webapp/src/components/ui/EmptyState.tsx.
import { Inbox } from 'lucide-react';
import { Card } from './Card';

export function EmptyState({
  title = 'Nothing here yet',
  description,
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Card className="py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-2 bg-midnight">
          <Inbox className="h-5 w-5 text-muted" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="max-w-md text-xs text-muted">{description}</p>}
      </div>
    </Card>
  );
}
