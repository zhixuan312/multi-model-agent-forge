import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';
import { PageFrame } from '@/components/ui';
import { ProfileForm } from './ProfileForm';

/**
 * Profile (Spec 1 §Profile / profile.html). Account (display name + avatar
 * tint) + change-password + sign-out. Username is read-only (the login key, F23).
 */
export default async function ProfilePage() {
  const member = await currentMember();
  if (!member) redirect('/login');

  return (
    <PageFrame
      title="Profile"
      description="Your account. Everyone on the team has equal rights — this is just you."
    >
      <ProfileForm member={member} />
    </PageFrame>
  );
}
