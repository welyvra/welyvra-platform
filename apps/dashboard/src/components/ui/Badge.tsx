// Adapted from Akkuea (MIT, Copyright (c) Acachete Labs), apps/webapp/src/components/ui/Badge.tsx:
// recolored with Welyvra tokens, client directive removed (pure presentational component).
import { cn } from '@/lib/cn';

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info';

const variants: Record<Variant, string> = {
  default: 'bg-slate text-muted border-slate-2',
  success: 'bg-mint/10 text-mint border-mint/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
  info: 'bg-iris/10 text-iris border-iris/30',
};

export function Badge({
  variant = 'default',
  children,
  className,
}: {
  variant?: Variant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        variants[variant],
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function statusVariant(status: string): Variant {
  switch (status) {
    case 'attributed':
    case 'resolved':
    case 'matched':
    case 'ok':
      return 'success';
    case 'unattributed':
    case 'open':
    case 'gap_detected':
      return 'danger';
    case 'investigating':
      return 'warning';
    case 'dismissed':
      return 'default';
    default:
      return 'info';
  }
}
