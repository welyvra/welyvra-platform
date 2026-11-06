import type { Metadata } from 'next';
import { Nav, Wordmark } from '@/components/Nav';
import { logout } from './actions';
import './globals.css';

export const metadata: Metadata = {
  title: 'Welyvra',
  description: 'Payments move. Records match.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-midnight font-sans text-white antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded focus:bg-iris focus:px-3 focus:py-2 focus:text-midnight"
        >
          Skip to content
        </a>
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row md:px-6">
          <aside className="flex shrink-0 flex-col gap-6 md:w-52">
            <Wordmark />
            <Nav />
            <form action={logout}>
              <button className="text-xs text-muted hover:text-white">Sign out</button>
            </form>
            <p className="text-[11px] leading-relaxed text-muted">Pre-alpha. Testnet only.</p>
          </aside>
          <main id="main" className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
