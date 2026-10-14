import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { readPodFile } from '@/lib/drive';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** One POD file. Who may see it is checked with the user's own access (team, or that client's POCs). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !user.is_active) return new NextResponse('Sign in first', { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 });
  const { data: f } = await (await createClient()).from('pod_files').select('path, filename, content_type').eq('id', id).maybeSingle();
  if (!f) return new NextResponse('Not found', { status: 404 });
  const buf = await readPodFile(createAdminClient(), f.path).catch(() => null);
  if (!buf) return new NextResponse('File not available', { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': f.content_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${String(f.filename).replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
