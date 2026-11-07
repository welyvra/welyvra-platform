import {
  Activity,
  BookOpen,
  FileWarning,
  LayoutDashboard,
  ListChecks,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';

const items = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/deposits', label: 'Deposits', icon: Wallet },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/reconciliation', label: 'Reconciliation', icon: ListChecks },
  { href: '/cases', label: 'Cases', icon: FileWarning },
  { href: '/audit', label: 'Audit log', icon: BookOpen },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Nav() {
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto md:flex-col">
      {items.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted hover:bg-slate hover:text-white"
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function Wordmark() {
  return (
    <span className="font-display text-lg font-semibold tracking-tight">
      welyvra<span className="text-mint">.</span>
      <Activity className="sr-only" aria-hidden="true" />
    </span>
  );
}
