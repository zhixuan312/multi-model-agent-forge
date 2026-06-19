import { NextResponse, type NextRequest } from 'next/server';
import { resolveAdminActor } from '@/auth/admin-gate-handler';
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
  const gate = await resolveAdminActor();
  if (!gate.ok) return gate.response;

  const tab = req.nextUrl.searchParams.get('tab') ?? 'overview';
  const periodParam = req.nextUrl.searchParams.get('period') ?? 'month';

  if (!VALID_TABS.has(tab)) {
    return NextResponse.json({ error: 'invalid_tab', message: `Invalid tab: ${tab}` }, { status: 400 });
  }

  const period = VALID_PERIODS.has(periodParam as Period) ? (periodParam as Period) : 'month';

  switch (tab) {
    case 'overview':
      return NextResponse.json(await usageOverview(period));
    case 'projects':
      return NextResponse.json(await usageByProject(period));
    case 'loops':
      return NextResponse.json(await usageByLoop(period));
    case 'standalone':
      return NextResponse.json(await usageStandalone(period));
    default:
      return NextResponse.json({ error: 'invalid_tab' }, { status: 400 });
  }
}
