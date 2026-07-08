export interface LegacyMemberRow {
  id: string;
  isAdmin: boolean;
  createdAt: Date;
}

export function mapLegacyMembersToRoles(rows: LegacyMemberRow[]) {
  const legacyAdmins = rows.filter((row) => row.isAdmin).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (legacyAdmins.length === 0) {
    throw new Error('0005_multi_tenancy requires at least one legacy is_admin member');
  }
  const orgAdminId = legacyAdmins[0]!.id;
  return rows
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((row) => ({
      memberId: row.id,
      role: row.id === orgAdminId ? 'org_admin' : row.isAdmin ? 'team_admin' : 'member',
      teamId: row.id === orgAdminId ? null : 'default-team-id',
    }));
}

export function buildMultiTenancyStatements(): string[] {
  return [
    'alter table forge.team_member add column role text',
    'alter table forge.team_member add column team_id uuid',
    'alter table forge.project add column team_id uuid',
    'alter table forge.workspace_repo add column team_id uuid',
    'alter table forge.ops_mma_batch add column team_id uuid',
    'alter table forge.loop_def add column team_id uuid',
    'alter table forge.loop_run add column team_id uuid',
    'update forge.project set team_id = $1 where team_id is null',
    'update forge.workspace_repo set team_id = $1 where team_id is null',
    'update forge.ops_mma_batch set team_id = $1 where team_id is null',
    'update forge.loop_def set team_id = $1 where team_id is null',
    'update forge.loop_run set team_id = $1 where team_id is null',
    'alter table forge.project alter column team_id set not null',
    'alter table forge.workspace_repo alter column team_id set not null',
    'alter table forge.ops_mma_batch alter column team_id set not null',
    'alter table forge.loop_def alter column team_id set not null',
    'alter table forge.loop_run alter column team_id set not null',
  ];
}
