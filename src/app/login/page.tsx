import Link from 'next/link';
import { SubmitButton } from '@/components/buttons';
import { Flash } from '@/components/ui';
import { param, type SearchParams } from '@/lib/flash';
import { sendReset, signIn } from './actions';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const reset = param(sp, 'mode') === 'reset';
  return (
    <main className="grid min-h-screen place-items-center bg-night px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-white">
          <div className="text-xl font-semibold">Lost &amp; POD desk</div>
          <div className="text-sm text-night-text">Shadowfax Trust &amp; Safety</div>
        </div>
        <div className="rounded-md bg-white p-6 shadow-sm">
          <Flash sp={sp} />
          {reset ? (
            <form action={sendReset} className="space-y-4">
              <h1 className="text-lg">Reset your password</h1>
              <label className="block">
                <span className="label">Work email</span>
                <input className="input" type="email" name="email" required autoComplete="email" defaultValue={param(sp, 'email')} />
              </label>
              <SubmitButton className="btn btn-primary w-full" pending="Sending…">Send reset link</SubmitButton>
              <Link href="/login" className="block text-center text-xs">Back to sign in</Link>
            </form>
          ) : (
            <form action={signIn} className="space-y-4">
              <h1 className="text-lg">Sign in</h1>
              <input type="hidden" name="next" value={param(sp, 'next')} />
              <label className="block">
                <span className="label">Work email</span>
                <input className="input" type="email" name="email" required autoComplete="email" defaultValue={param(sp, 'email')} />
              </label>
              <label className="block">
                <span className="label">Password</span>
                <input className="input" type="password" name="password" required autoComplete="current-password" />
              </label>
              <SubmitButton className="btn btn-primary w-full" pending="Signing in…">Sign in</SubmitButton>
              <Link href="/login?mode=reset" className="block text-center text-xs">Forgot password?</Link>
            </form>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-night-text/80">Accounts are created by an admin. Ask your admin for access.</p>
      </div>
    </main>
  );
}
