// @vitest-environment node
import { FORGE_ACTOR, FORGE_AVATAR_TINT, FORGE_DISPLAY_NAME, FORGE_MEMBER_ID, isForgeSystemMember } from '@/automation/forge-member';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Forge's name and tint were written out inline in a dozen places, and one of them had
 * drifted: PlanStageClient used `#8B6914`, so Forge wore a different colour in the plan
 * mention list than in Spec or the activity feed. Nobody would notice — it is one avatar,
 * on one surface.
 */
describe('Forge identity', () => {
  it('is one id, name and tint', () => {
    expect(FORGE_MEMBER_ID).toBe('00000000-0000-0000-0000-000000000000');
    expect(FORGE_DISPLAY_NAME).toBe('Forge');
    expect(FORGE_AVATAR_TINT).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(FORGE_ACTOR).toEqual({ id: FORGE_MEMBER_ID, name: FORGE_DISPLAY_NAME, tint: FORGE_AVATAR_TINT });
  });

  it('recognises only the system member', () => {
    expect(isForgeSystemMember(FORGE_MEMBER_ID)).toBe(true);
    expect(isForgeSystemMember('11111111-1111-1111-1111-111111111111')).toBe(false);
    expect(isForgeSystemMember('')).toBe(false);
  });

  it('is not re-spelled inline anywhere in shipped code', () => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) out.push(...walk(rel));
        else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
      }
      return out;
    };
    // The governance previews demo fictional members by design, and forge-member.ts
    // documents the literal it replaced.
    const EXEMPT = ['src/components/governance/', 'src/automation/forge-member.ts'];
    const offenders: string[] = [];
    for (const rel of [...walk('src'), ...walk('app')]) {
      if (EXEMPT.some((e) => rel.includes(e))) continue;
      const text = readFileSync(join(process.cwd(), rel), 'utf8');
      if (/(?:displayName|name):\s*'Forge'/.test(text)) offenders.push(rel);
    }
    expect(offenders, 'import FORGE_DISPLAY_NAME instead of writing it out').toEqual([]);
  });
});
