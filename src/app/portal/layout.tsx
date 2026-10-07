import Link from 'next/link';
import { requirePoc } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePoc();
  const supabase = await createClient();
  const { data: clients } = await supabase.from('clients').select('name').order('name');
  return (
    <div className="min-h-screen">
      <header className="bg-night text-white">
        <div className="mx-auto flex max-w-[1300px] items-center gap-6 px-6 py-3">
          <Link href="/portal" className="font-semibold text-white no-underline hover:no-underline">
            Shadowfax escalations
            <span className="ml-2 font-normal text-night-text">{(clients ?? []).map((c) => c.name).join(', ')}</span>
          </Link>
          <nav className="flex gap-1 text-sm">
            <Link href="/portal" className="rounded px-2 py-1 text-night-text no-underline hover:bg-night-2 hover:text-white hover:no-underline">Cases</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-night-text">{user.full_name ?? user.email}</span>
            <form action="/signout" method="post"><button className="btn btn-sm border-night-3 bg-night-2 text-white hover:bg-night-3">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1300px] px-6 py-6">{children}</main>
    </div>
  );
}
