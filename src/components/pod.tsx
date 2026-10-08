import { AgingRibbon, Kpi } from './ui';
import type { PodStats } from '@/lib/cases/filters';

/** The five numbers that matter: still waiting for a POD, critical, POD shared, loss requested, loss accepted. */
export function PodTiles({ s, href, clientView }: {
  s: PodStats;
  href: (key: 'pending' | 'critical' | 'shared' | 'lost_pending' | 'lost') => string;
  clientView?: boolean;
}) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
      <Kpi label="Pending POD" value={s.pending} href={href('pending')} />
      <Kpi label={`Critical — over ${s.critical_days} days`} value={s.critical} tone={s.critical ? 'alert' : undefined} href={href('critical')} />
      <Kpi label="POD shared / closed" value={s.pod_shared + s.closed} href={href('shared')} />
      <Kpi label={clientView ? 'Loss requested — under review' : 'Loss requested'} value={s.lost_pending} tone={s.lost_pending ? 'warn' : undefined} href={href('lost_pending')} />
      <Kpi label="Loss accepted" value={s.lost} href={href('lost')} />
    </div>
  );
}

/** Pending POD split by days since escalation; the buckets after the critical line are the ones to chase. */
export function PendingAgeBar({ s, hrefFor }: { s: PodStats; hrefFor: (min: number, max: number | null) => string }) {
  return (
    <AgingRibbon
      buckets={s.pending_age.map((b) => ({ label: b.label, count: b.count }))}
      hrefFor={(label) => {
        const b = s.pending_age.find((x) => x.label === label)!;
        return hrefFor(b.min, b.max);
      }}
    />
  );
}
