import { redirect } from 'next/navigation';
import { currentMember } from '@/auth/current-member';

/**
 * Root → the role-appropriate landing surface. Auth gating happens in the
 * middleware + `(app)/layout`, but the landing DESTINATION is role-based:
 * an `org_admin` has no team scope (team_id is null) and does no day-to-day
 * project work, so their home is the org-level usage view. Everyone else
 * lands on their team's project pipeline. Routing a team-less org admin to
 * `/projects` would bounce off its team-scope guard back to `/` and loop.
 */
export default async function Home() {
  const member = await currentMember();
  if (!member) redirect('/login');
  redirect(member.role === 'org_admin' ? '/usage' : '/projects');
}
