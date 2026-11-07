import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-iris text-midnight hover:bg-iris/90',
  secondary: 'border border-slate-2 bg-slate text-white hover:bg-slate-2',
  danger: 'border border-danger/40 text-danger hover:bg-danger/10',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
