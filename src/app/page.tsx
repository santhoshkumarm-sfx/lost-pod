import { redirect } from 'next/navigation';
import { isInternalRole, requireUser } from '@/lib/auth';

export default async function Home() {
  const user = await requireUser();
  redirect(isInternalRole(user.role) ? '/dashboard' : '/portal');
}
