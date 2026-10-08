import Link from 'next/link';
import { Sidebar, type NavItem } from '@/components/Sidebar';
import { isAdminRole, requireInternal, ROLE_LABELS } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireInternal();
  const admin = isAdminRole(user.role);
  const supabase = await createClient();
  const { data: counts } = await supabase.rpc('sidebar_counts');
  const c = (counts ?? {}) as { unread?: number; emails?: number; lost_requests?: number };

  const work: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/cases', label: 'Cases' },
    { href: '/email-escalations', label: 'Email escalations', badge: c.emails ?? 0 },
    { href: '/imports', label: 'Google Sheet imports' },
    { href: '/lost-approval', label: 'Lost approval', badge: c.lost_requests ?? 0 },
  ];
  const people: NavItem[] = [
    { href: '/clients', label: 'Clients' },
    { href: '/pocs', label: 'POCs' },
    ...(admin ? [{ href: '/users', label: 'Users' }] : []),
  ];
  const admin_: NavItem[] = [
    ...(admin ? [{ href: '/reports', label: 'Reports' }] : []),
    { href: '/data-quality', label: 'Data quality' },
    ...(admin ? [{ href: '/audit', label: 'Audit log' }, { href: '/settings', label: 'Settings' }] : []),
  ];

  return (
    <div className="flex min-h-screen">
      <Sidebar
        groups={[{ items: work }, { title: 'Clients and people', items: people }, { title: 'Administration', items: admin_ }]}
        footer={
          <div>
            <div className="truncate text-white">{user.full_name ?? user.email}</div>
            <div className="text-night-text/70">{ROLE_LABELS[user.role]}</div>
          </div>
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-white/95 px-6 py-2 backdrop-blur">
          <form action="/cases" className="flex max-w-xl flex-1 items-center gap-2">
            <input type="hidden" name="category" value="all" />
            <input
              name="q"
              className="input"
              placeholder="Search AWB (or paste several), client, subject, hub, POC, agent"
              aria-label="Search cases"
            />
            <input type="hidden" name="category" value="all" />
            <button className="btn">Search</button>
          </form>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/notifications" className="btn btn-ghost">
              Notifications
              {!!c.unread && <span className="rounded-sm bg-age-3 px-1.5 text-2xs font-semibold text-white">{c.unread}</span>}
            </Link>
            <form action="/signout" method="post">
              <button className="btn btn-ghost">Sign out</button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
