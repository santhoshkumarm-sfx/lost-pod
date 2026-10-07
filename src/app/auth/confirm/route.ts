import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/** Handles invite, recovery and magic-link emails (token_hash) and PKCE codes. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const code = url.searchParams.get('code');
  const nextParam = url.searchParams.get('next') ?? '/';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
  const supabase = await createClient();

  let error: string | null = null;
  if (tokenHash && type) {
    const res = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    error = res.error?.message ?? null;
  } else if (code) {
    const res = await supabase.auth.exchangeCodeForSession(code);
    error = res.error?.message ?? null;
  } else {
    error = 'The link is incomplete.';
  }
  const dest = url.clone();
  dest.search = '';
  if (error) {
    dest.pathname = '/login';
    dest.searchParams.set('error', 'This link has expired or was already used. Ask for a new one.');
  } else {
    dest.pathname = type === 'invite' || type === 'recovery' ? '/update-password' : next;
  }
  return NextResponse.redirect(dest);
}
