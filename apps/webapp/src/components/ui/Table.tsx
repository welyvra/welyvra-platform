import { cn } from '@/lib/cn';

export function Table({
  caption,
  head,
  children,
}: {
  caption: string;
  head: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-2">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate/80 text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className={cn('px-4 py-3 font-medium', h === 'Amount' && 'text-right')}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-2">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <td className={cn('px-4 py-3 align-middle', className)}>{children}</td>
);

export const Mono = ({ children, title }: { children: React.ReactNode; title?: string }) => (
  <span className="font-mono text-xs text-muted" title={title}>
    {children}
  </span>
);
