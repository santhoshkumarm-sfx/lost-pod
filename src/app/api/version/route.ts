import { NextResponse } from 'next/server';
import { APP_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ app: 'POD lost', version: APP_VERSION });
}
