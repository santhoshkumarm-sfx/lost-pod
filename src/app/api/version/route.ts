import { NextResponse } from 'next/server';
import { APP_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ app: 'POD connect', version: APP_VERSION });
}
