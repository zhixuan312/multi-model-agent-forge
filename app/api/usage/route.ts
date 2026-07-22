import { NextResponse, type NextRequest } from 'next/server';
import { currentMember } from '@/auth/current-member';
import {
  usageOverview,
  usageByProject,
  usageByLoop,
  usageStandalone,
  type Period,
} from '@/usage/usage-core';

const VALID_TABS = new Set(['overview', 'projects', 'loops', 'standalone']);
const VALID_PERIODS = new Set<Period>(['week', 'month', '30d', '90d', 'all']);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') as 'org' | 'team' | null;
  const tab = url.searchParams.get('tab') ?? 'overview';
  const periodParam = url.searchParams.get('period') ?? 'month';

  if (!VALID_TABS.has(tab)) {
    return NextResponse.json({ error: 'invalid_tab', message: `Invalid tab: ${tab}` }, { status: 400 });
  }

  const period = VALID_PERIODS.has(periodParam as Period) ? (periodParam as Period) : 'month';

  if (scope === 'org') {
    const member = await currentMember();
    if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (member.role !== 'org_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const result = await usageOverview(period, { scope: 'org' });
    return NextResponse.json(result);
  }

  // Team-facing path (default). Resolve the member directly and return proper 401/403 — the old
  // `requireTeamScope()` threw a plain Error for an authed-but-teamless org admin (or a stale
  // cookie), surfacing as a 500 instead of an auth status.
  const member = await currentMember();
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!member.teamId) {
    return NextResponse.json({ error: 'no_team', message: 'This view is team-scoped; use ?scope=org.' }, { status: 403 });
  }
  const deps = { teamId: member.teamId };

  switch (tab) {
    case 'overview':
      return NextResponse.json(await usageOverview(period, deps));
    case 'projects':
      return NextResponse.json(await usageByProject(period, deps));
    case 'loops':
      return NextResponse.json(await usageByLoop(period, deps));
    case 'standalone':
      return NextResponse.json(await usageStandalone(period, deps));
    default:
      return NextResponse.json({ error: 'invalid_tab' }, { status: 400 });
  }
}
