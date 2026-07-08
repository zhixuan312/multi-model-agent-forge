import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';

export default async function SettingsPage() {
  const member = await currentMember();
  if (!member) redirect('/login');
  redirect(member.role === 'org_admin' ? '/settings/org' : '/settings/team');
}
