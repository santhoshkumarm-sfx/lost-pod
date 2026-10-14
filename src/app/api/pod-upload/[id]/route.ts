import { NextResponse } from 'next/server';
import { getSessionUser, isInternalRole } from '@/lib/auth';
import { putChunk } from '@/lib/drive';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Team: one chunk (≤ 2 MB) of an upload started with POST /api/pod-upload. ?offset=<bytes already sent>. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !user.is_active || !isInternalRole(user.role)) return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  const { id } = await params;
  const sb = createAdminClient();
  const { data: up } = await sb.from('pod_uploads').select('session_url, size_bytes, uploaded_by, drive_file_id').eq('id', id).maybeSingle();
  if (!up || up.uploaded_by !== user.id) return NextResponse.json({ error: 'Unknown upload' }, { status: 404 });
  if (up.drive_file_id) return NextResponse.json({ done: true, path: `drive:${up.drive_file_id}` });
  const offset = Number(new URL(req.url).searchParams.get('offset')) || 0;
  const chunk = Buffer.from(await req.arrayBuffer());
  try {
    const fileId = await putChunk(up.session_url, chunk, offset, Number(up.size_bytes) || 0);
    if (!fileId) return NextResponse.json({ done: false });
    await sb.from('pod_uploads').update({ drive_file_id: fileId }).eq('id', id);
    return NextResponse.json({ done: true, path: `drive:${fileId}` });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
