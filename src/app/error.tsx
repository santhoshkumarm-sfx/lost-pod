'use client';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <h1>Something went wrong</h1>
      <p className="mt-2 text-ink-soft">{error.message || 'The page failed to load.'}</p>
      {error.digest && <p className="mt-1 text-xs text-ink-faint">Reference: {error.digest}</p>}
      <button className="btn mt-6" onClick={reset}>Try again</button>
    </main>
  );
}
