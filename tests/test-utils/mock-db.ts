import { getTableName } from 'drizzle-orm';
import type { Db } from '@/db/client';
import type { SecretStore } from '@/secrets/secret-store';

/**
 * Mock `SecretStore` (real crypto is covered separately in secret-store.test.ts).
 * Records puts/deletes so a test can assert the plaintext never reached a column
 * and that superseded secrets are dropped; resolves a fresh ref per put.
 */
export function createMockSecretStore(): SecretStore & {
  readonly puts: Array<{ label: string; plaintext: string; ref: string }>;
  readonly deleted: string[];
} {
  const puts: Array<{ label: string; plaintext: string; ref: string }> = [];
  const deleted: string[] = [];
  const values = new Map<string, string>();
  let n = 0;
  return {
    puts,
    deleted,
    async put(label, plaintext) {
      const ref = `secret-ref-${(n += 1)}`;
      puts.push({ label, plaintext, ref });
      values.set(ref, plaintext);
      return ref;
    },
    async get(id) {
      return values.get(id) ?? null;
    },
    async delete(id) {
      deleted.push(id);
      values.delete(id);
    },
  };
}

/**
 * Mock Drizzle `Db` — the project-wide standard for backend tests (the same
 * philosophy as gumi's `createMockSupabase`, adapted to Drizzle). Tests NEVER
 * touch a real database: inject this via a core's `deps.db`, or `vi.mock('@/db/client',
 * () => ({ getDb: () => createMockDb(...) }))` for route handlers.
 *
 * Hand it canned result sets keyed by the table the query targets — by db table
 * name (`getTableName`), optionally prefixed with the operation:
 *   createMockDb({ 'iam_member': [{ id: 'm1' }] })            // any op on the table
 *   createMockDb({ 'select:iam_member': [...], 'insert:iam_member': [...] })
 *   createMockDb({ 'select:iam_member': seq([row], [{ n: 1 }]) })  // sequential reads
 *
 * Every chain node is awaitable AND chainable (`.from/.where/.limit/.leftJoin/
 * .groupBy/.orderBy/.values/.set/.returning/.onConflictDoNothing/…`), so it
 * mirrors how a query resolves at any terminal. `db.transaction(fn)` runs `fn`
 * with the same mock (so the txn sees the same canned data + records its calls).
 *
 * Every method invocation is recorded for white-box assertions:
 *   db._assertCalled('iam_member', 'insert')
 *   db._callsFor('settings_connection')
 */
export interface MockQueryCall {
  op: 'select' | 'insert' | 'update' | 'delete';
  method: string;
  table: string;
  args: unknown[];
}

type ResultSet = unknown[];
type Yield = ResultSet | Error;
type Responder = Yield | ((callIndex: number) => Yield);
export type MockResponses = Record<string, Responder>;

export interface MockDb {
  _calls: MockQueryCall[];
  _callsFor(table: string): MockQueryCall[];
  _assertCalled(table: string, method: string): boolean;
  _reset(): void;
}

/** Sequence distinct result sets for repeated reads of the SAME table in one test. */
export function seq(...sets: ResultSet[]): (i: number) => ResultSet {
  return (i: number) => sets[Math.min(i, sets.length - 1)] ?? [];
}

const tableName = (t: unknown): string => {
  try {
    return getTableName(t as never);
  } catch {
    return String(t);
  }
};

export function createMockDb(responses: MockResponses = {}): Db & MockDb {
  const calls: MockQueryCall[] = [];
  const seqCounters: Record<string, number> = {};

  function resolveRows(op: string, table: string): Yield {
    const key = `${op}:${table}`;
    const responder = responses[key] ?? responses[table];
    if (responder === undefined) return [];
    if (typeof responder === 'function') {
      const i = (seqCounters[key] ??= 0);
      seqCounters[key] = i + 1;
      return responder(i);
    }
    return responder;
  }

  function makeChain(ctx: { op: MockQueryCall['op']; table: string }): unknown {
    const proxy: unknown = new Proxy(function noop() {}, {
      get(_t, prop) {
        if (prop === 'then') {
          const rows = resolveRows(ctx.op, ctx.table);
          // A responder may yield an Error to simulate a failing query (e.g. a
          // 23505 unique-violation) so error paths are testable.
          return (resolve: (v: ResultSet) => unknown, reject: (e: unknown) => unknown) =>
            rows instanceof Error ? reject(rows) : resolve(rows);
        }
        return (...args: unknown[]) => {
          // `select().from(table)` sets the response key; record a synthetic
          // 'select' marker once the table is known so `_assertCalled(t,'select')` works.
          if ((prop === 'from' || prop === 'into') && args[0]) {
            ctx.table = tableName(args[0]);
            calls.push({ op: ctx.op, method: ctx.op, table: ctx.table, args });
          }
          calls.push({ op: ctx.op, method: String(prop), table: ctx.table, args });
          return proxy;
        };
      },
      apply() {
        return proxy;
      },
    });
    return proxy;
  }

  /** Record the initiating op (table known at call time for insert/update/delete). */
  function initChain(op: MockQueryCall['op'], t: unknown): unknown {
    const table = tableName(t);
    calls.push({ op, method: op, table, args: [t] });
    return makeChain({ op, table });
  }

  const api = {
    select: (..._proj: unknown[]) => makeChain({ op: 'select', table: '?' }),
    insert: (t: unknown) => initChain('insert', t),
    update: (t: unknown) => initChain('update', t),
    delete: (t: unknown) => initChain('delete', t),
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return fn(out as unknown as Db);
    },
    _calls: calls,
    _callsFor: (table: string) => calls.filter((c) => c.table === table),
    _assertCalled: (table: string, method: string) =>
      calls.some((c) => c.table === table && c.method === method),
    _reset: () => {
      calls.length = 0;
      for (const k of Object.keys(seqCounters)) delete seqCounters[k];
    },
  };

  const out = api as unknown as Db & MockDb;
  return out;
}
