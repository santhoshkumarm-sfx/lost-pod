import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { podRequestXlsx, type PodItem } from '@/lib/pod/request';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Consolidated Excel of one POD request (same visibility as the request itself). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !user.is_active) return new NextResponse('Sign in first', { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 });
  const sb = await createClient();
  const { data: up } = await sb.from('case_uploads').select('request_no, clients(name)').eq('id', id).maybeSingle();
  if (!up) return new NextResponse('Not found', { status: 404 });
  const { data: items } = await sb.from('pod_request_items').select('awb, result, pod_link, other_links, case_id').eq('upload_id', id);
  const u = up as unknown as { request_no: number | null; clients: { name: string } | null };
  const buf = await podRequestXlsx(u.request_no, u.clients?.name ?? null, (items ?? []) as PodItem[]);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="PR-${u.request_no ?? ''} PODs.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
