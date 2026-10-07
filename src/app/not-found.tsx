import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1>Not found</h1>
      <p className="mt-2 text-ink-soft">This page or record does not exist, or your account cannot see it.</p>
      <Link href="/" className="btn mt-6">Go to your dashboard</Link>
    </main>
  );
}
