import { NextResponse } from 'next/server';
import { getSessionUser, isInternalRole } from '@/lib/auth';
import { startUpload } from '@/lib/drive';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Team: start uploading one POD file to Google Drive. Body: { name, type, size }. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !user.is_active || !isInternalRole(user.role)) return NextResponse.json({ error: 'Only the Shadowfax team can upload PODs' }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { name?: string; type?: string; size?: number };
  const name = String(b.name ?? '').slice(0, 200) || 'POD';
  const size = Number(b.size) || 0;
  if (size > 50 * 1024 * 1024) return NextResponse.json({ error: 'Files up to 50 MB' }, { status: 400 });
  try {
    const sb = createAdminClient();
    const session = await startUpload(sb, name, b.type || 'application/octet-stream', size);
    const { data, error } = await sb.from('pod_uploads').insert({ session_url: session, name, content_type: b.type || null, size_bytes: size, uploaded_by: user.id }).select('id').single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ id: data.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
