import { redirect } from 'next/navigation';
import { SubmitButton } from '@/components/buttons';
import { Flash } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { str, type SearchParams } from '@/lib/flash';

export const metadata = { title: 'Set password' };

async function updatePassword(fd: FormData) {
  'use server';
  const password = str(fd, 'password');
  if (password.length < 10) redirect('/update-password?error=Use%20at%20least%2010%20characters.');
  if (password !== str(fd, 'confirm')) redirect('/update-password?error=The%20two%20passwords%20do%20not%20match.');
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(`/update-password?error=${encodeURIComponent(error.message)}`);
  redirect('/?ok=Password%20saved.');
}

export default async function UpdatePasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login?error=Open%20the%20link%20from%20your%20email%20again.');
  return (
    <main className="grid min-h-screen place-items-center bg-night px-4">
      <form action={updatePassword} className="w-full max-w-sm space-y-4 rounded-md bg-white p-6">
        <h1 className="text-lg">Set your password</h1>
        <p className="text-ink-soft">For {data.user.email}</p>
        <Flash sp={sp} />
        <label className="block">
          <span className="label">New password</span>
          <input className="input" type="password" name="password" minLength={10} required autoComplete="new-password" />
        </label>
        <label className="block">
          <span className="label">Repeat password</span>
          <input className="input" type="password" name="confirm" minLength={10} required autoComplete="new-password" />
        </label>
        <SubmitButton className="btn btn-primary w-full">Save password</SubmitButton>
      </form>
    </main>
  );
}
