'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-danger/40 bg-danger/5 p-6">
      <h1 className="font-display text-lg font-semibold">Something went wrong</h1>
      <p className="mt-1 text-sm text-muted">
        The API could not be reached or returned an error. No data was changed.
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-lg border border-slate-2 px-3 py-1.5 text-sm hover:bg-slate"
      >
        Try again
      </button>
    </div>
  );
}
