import fs from 'node:fs';
import path from 'node:path';

/**
 * MockTable — a generic, file-backed, in-memory collection of plain-JSON records.
 * The reusable heart of the mock backend: each domain (members, providers, …)
 * wraps one of these around a committed seed. Reads serve from an in-memory cache
 * (loaded once per server process); writes mutate the cache AND persist to a
 * working JSON file under `.mock-db/` (gitignored) so changes survive reloads and
 * can be inspected. The committed seed is never mutated.
 *
 * Not used in tests (the `*-core` mock guards are gated to dev only), so the fs
 * access here never runs under vitest.
 */

const WORK_DIR = path.join(process.cwd(), '.mock-db');

function ensureDir(): void {
  try {
    fs.mkdirSync(WORK_DIR, { recursive: true });
  } catch {
    /* best-effort */
  }
}

export class MockTable<T extends object> {
  private rows: T[] | null = null;

  /**
   * @param name  collection name → `.mock-db/<name>.json`
   * @param seed  produces the initial records (typically `() => seedJson`)
   */
  constructor(
    private readonly name: string,
    private readonly seed: () => T[],
  ) {}

  private file(): string {
    return path.join(WORK_DIR, `${this.name}.json`);
  }

  private load(): T[] {
    if (this.rows) return this.rows;
    try {
      this.rows = JSON.parse(fs.readFileSync(this.file(), 'utf8')) as T[];
    } catch {
      this.rows = structuredClone(this.seed());
      this.persist();
    }
    return this.rows;
  }

  private persist(): void {
    ensureDir();
    try {
      fs.writeFileSync(this.file(), JSON.stringify(this.rows ?? [], null, 2));
    } catch {
      /* best-effort */
    }
  }

  /** All records (shallow copies — callers can't mutate the store by reference). */
  all(): T[] {
    return this.load().map((r) => ({ ...r }));
  }

  find(match: (r: T) => boolean): T | undefined {
    const r = this.load().find(match);
    return r ? { ...r } : undefined;
  }

  insert(row: T): T {
    this.load().push(row);
    this.persist();
    return { ...row };
  }

  /** Patch the first matching row; returns the updated copy, or null if none. */
  update(match: (r: T) => boolean, patch: Partial<T>): T | null {
    const row = this.load().find(match);
    if (!row) return null;
    Object.assign(row, patch);
    this.persist();
    return { ...row };
  }

  remove(match: (r: T) => boolean): boolean {
    const rows = this.load();
    const i = rows.findIndex(match);
    if (i < 0) return false;
    rows.splice(i, 1);
    this.persist();
    return true;
  }

  /** Reset back to the committed seed (drops the working copy). */
  reset(): void {
    this.rows = structuredClone(this.seed());
    this.persist();
  }
}
