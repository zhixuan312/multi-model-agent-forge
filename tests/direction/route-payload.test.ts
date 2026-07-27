import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkDirectionImportBoundary } from '../../scripts/check-direction-import-boundary';

function tree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'forge-direction-scope-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

describe('checkDirectionImportBoundary', () => {
  it('passes when only the /settings/guide route tree and direction components import the content', () => {
    const root = tree({
      'app/(app)/settings/guide/[sectionId]/page.tsx': "import { DIRECTION_SECTIONS } from '@/content/direction-sections';",
      'src/components/direction/DirectionSection.tsx': "import { PRINCIPLES } from '@/content/direction-reference';",
      'app/(app)/projects/page.tsx': "import { foo } from '@/lib/foo';",
    });
    try {
      expect(() => checkDirectionImportBoundary(root)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not flag the Sidebar for importing the lightweight guide-nav projection', () => {
    const root = tree({
      'app/(app)/settings/guide/page.tsx': "import { GUIDE_FIRST_SECTION_ID } from '@/content/guide-nav';",
      'src/components/forge/Sidebar.tsx': "import { GUIDE_NAV_SECTIONS, GUIDE_PARTS } from '@/content/guide-nav';",
    });
    try {
      expect(() => checkDirectionImportBoundary(root)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails naming the out-of-boundary importer', () => {
    const root = tree({
      'app/(app)/projects/page.tsx': "import { DIRECTION_SECTIONS } from '@/content/direction-sections';",
    });
    try {
      expect(() => checkDirectionImportBoundary(root)).toThrow(/projects[\\/]+page\.tsx/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('flags a shared component that pulls in a direction renderer', () => {
    const root = tree({
      'src/components/forge/Sidebar.tsx': "import { DirectionSection } from '@/components/direction/DirectionSection';",
    });
    try {
      expect(() => checkDirectionImportBoundary(root)).toThrow(/Sidebar\.tsx/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('holds for the real repository', () => {
    expect(() => checkDirectionImportBoundary(process.cwd())).not.toThrow();
  });
});
