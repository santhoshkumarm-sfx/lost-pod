'use server';
import { redirect } from 'next/navigation';
import { publicEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { str } from '@/lib/flash';

export async function signIn(fd: FormData) {
  const email = str(fd, 'email').toLowerCase();
  const password = str(fd, 'password');
  const next = str(fd, 'next');
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent('Email or password is incorrect.')}&email=${encodeURIComponent(email)}`);
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
}

export async function sendReset(fd: FormData) {
  const email = str(fd, 'email').toLowerCase();
  if (!email.includes('@')) redirect('/login?mode=reset&error=Enter%20your%20work%20email.');
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${publicEnv.siteUrl}/auth/callback?next=/update-password` });
  // Same answer whether or not the account exists.
  redirect('/login?ok=If%20that%20email%20has%20an%20account%2C%20a%20reset%20link%20is%20on%20its%20way.');
}
