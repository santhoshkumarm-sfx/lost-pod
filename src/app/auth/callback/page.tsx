'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';

/**
 * Landing page for links in Supabase's standard invite / reset-password emails.
 * - Admin invites and resets arrive with the session in the URL fragment (#access_token=…), which only
 *   the browser can read: store it as the cookie session, then continue.
 * - Links that carry ?code= or ?token_hash= are handed to the server route /auth/confirm.
 */
export default function AuthCallback() {
  const [message, setMessage] = useState('Signing you in…');

  useEffect(() => {
    const url = new URL(window.location.href);
    const next = url.searchParams.get('next') ?? '/';
    const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const fail = (why: string) => {
      setMessage(why);
      setTimeout(() => window.location.replace(`/login?error=${encodeURIComponent(why)}`), 1500);
    };

    const err = hash.get('error_description') ?? url.searchParams.get('error_description');
    if (err) return fail('This link has expired or was already used. Ask an admin for a new one.');

    if (url.searchParams.get('code') || url.searchParams.get('token_hash')) {
      window.location.replace(`/auth/confirm${url.search}`);
      return;
    }

    const access_token = hash.get('access_token');
    const refresh_token = hash.get('refresh_token');
    if (!access_token || !refresh_token) return fail('The link is incomplete. Open it again from the email.');

    const type = hash.get('type');
    createClient()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error }) => {
        if (error) return fail('This link has expired or was already used. Ask an admin for a new one.');
        window.location.replace(type === 'invite' || type === 'recovery' ? '/update-password' : safeNext);
      });
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-night px-4 text-white">
      <p>{message}</p>
    </main>
  );
}
