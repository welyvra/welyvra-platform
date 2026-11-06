// Adapted from Akkuea (MIT, Copyright (c) Acachete Labs), apps/webapp/src/components/ui/Card.tsx:
// Welyvra tokens, no animation library.
import { cn } from '@/lib/cn';

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('rounded-xl border border-slate-2 bg-slate/60 p-5', className)}
      {...props}
    >
      {children}
    </section>
  );
}

export function CardTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <h2 className={cn('text-sm font-semibold text-white', className)}>{children}</h2>;
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}
