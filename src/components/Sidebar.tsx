'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

export function Sidebar({ groups, footer }: { groups: { title?: string; items: NavItem[] }[]; footer: React.ReactNode }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col bg-night text-night-text">
      <div className="px-4 pb-4 pt-5">
        <Link href="/" className="block text-[15px] font-semibold leading-tight text-white no-underline hover:no-underline">
          Lost &amp; POD desk
        </Link>
        <div className="mt-0.5 text-xs text-night-text/70">Trust &amp; Safety</div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.map((g, gi) => (
          <div key={gi} className={gi ? 'mt-4' : ''}>
            {g.title && <div className="px-2 pb-1 text-2xs text-night-text/60">{g.title}</div>}
            {g.items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className={`flex items-center justify-between rounded px-2 py-1.5 text-[13px] no-underline hover:no-underline ${
                  active(it.href) ? 'bg-night-3 font-medium text-white' : 'text-night-text hover:bg-night-2 hover:text-white'
                }`}
              >
                <span>{it.label}</span>
                {!!it.badge && <span className="rounded-sm bg-age-3 px-1.5 text-2xs font-semibold text-white">{it.badge}</span>}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="border-t border-night-2 px-4 py-3 text-xs">{footer}</div>
    </aside>
  );
}
