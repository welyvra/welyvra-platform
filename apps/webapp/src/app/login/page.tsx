import { login } from '../actions';

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; expired?: string }>;
}) {
  const { error, expired } = await searchParams;
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-slate-2 bg-slate/60 p-6">
      <h1 className="font-display text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">
        Paste an API key. It is stored in an httpOnly cookie on this server and never sent to your
        browser scripts.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          That does not look like a Welyvra API key.
        </p>
      )}
      {expired && (
        <p role="alert" className="mt-3 text-sm text-warning">
          Your key was rejected. Sign in again.
        </p>
      )}
      <form action={login} className="mt-5 space-y-3">
        <label htmlFor="apiKey" className="block text-xs text-muted">
          API key
        </label>
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          autoComplete="off"
          required
          className="w-full rounded-lg border border-slate-2 bg-midnight px-3 py-2 font-mono text-sm"
          placeholder="wlv_…"
        />
        <button className="w-full rounded-lg bg-iris px-3.5 py-2 text-sm font-medium text-midnight hover:bg-iris/90">
          Continue
        </button>
      </form>
    </div>
  );
}
