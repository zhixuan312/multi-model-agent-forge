// @vitest-environment node
// A MOCK MmaClient for Spec-4 Part-B tests — NEVER dispatches to a real mma.
// It records each dispatchAndWait call (route + cwd + body) and returns scripted
// terminal envelopes per route. Built on the real MmaClient with a fetch stub so
// the dispatch→poll path is exercised, but the wire is fully canned.
import { MmaClient, type MmaClientConfig } from '@/mma/client';

export interface RecordedDispatch {
  route: string;
  cwd: string;
  body: unknown;
}

const baseCfg: MmaClientConfig = {
  baseUrl: 'http://127.0.0.1:7337',
  token: 'test-bearer',
  mainModel: 'claude-opus-4-8',
};

/**
 * Build a MmaClient whose dispatch→poll returns the given terminal envelope for
 * the next call of each route. `calls` captures every dispatch for assertions
 * (the cwd MUST be the workspace root for audit/journal-record).
 */
export function mockMma(opts: {
  /** Terminal envelope to return for the NEXT dispatch of each route (a queue). */
  envelopes: Partial<Record<string, unknown[]>>;
  /** Records every dispatchAndWait call (route + cwd + body). */
  calls?: RecordedDispatch[];
  /** When set for a route, the poll never reaches terminal (hung 202) → wait timeout. */
  hang?: Set<string>;
}): MmaClient {
  const queues: Record<string, unknown[]> = {};
  for (const [route, envs] of Object.entries(opts.envelopes)) {
    queues[route] = [...(envs ?? [])];
  }

  // Map a dispatched batchId back to the route + its scripted envelope.
  let nextId = 1;
  const pending = new Map<string, { route: string; envelope: unknown; hang: boolean }>();

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';

    if (method === 'POST') {
      // Dispatch: POST /task?cwd=... with { type, ...body }
      const u = new URL(url);
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      const type = typeof body?.type === 'string' ? body.type : '';
      const route = type === 'journal_record' ? 'journal-record' : type;
      const cwd = u.searchParams.get('cwd') ?? '';
      const { type: _type, ...payload } = body ?? {};
      opts.calls?.push({ route, cwd, body: payload });

      const envelope = (queues[route] ?? []).shift();
      const hang = opts.hang?.has(route) ?? false;
      const batchId = `b-${nextId++}`;
      pending.set(batchId, { route, envelope, hang });
      return new Response(JSON.stringify({ batchId }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Poll: GET /task/:id
    const m = url.match(/\/task\/([^/?]+)/);
    const batchId = m ? decodeURIComponent(m[1]) : '';
    const entry = pending.get(batchId);
    if (!entry || entry.hang) {
      // Pending forever (until the client's wait-timeout fires).
      return new Response('running…', { status: 202, headers: { 'content-type': 'text/plain' } });
    }
    return new Response(JSON.stringify(entry.envelope ?? {}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return new MmaClient(baseCfg, {
    fetchImpl,
    pollIntervalMs: 1,
    waitTimeoutMs: 50,
    client: 'claude-code',
  });
}

/** A clean audit envelope (no critical/high → verdict 'clean'). */
export function auditEnvelope(
  findings: Array<{ severity: string; category?: string; claim?: string }>,
  extra?: { headline?: string; contextBlockId?: string },
): unknown {
  return {
    headline: extra?.headline ?? `audit: ${findings.length} finding(s)`,
    results: [],
    batchTimings: { kind: 'not_applicable' },
    costSummary: { kind: 'not_applicable' },
    structuredReport: {
      summary: `${findings.length} finding(s)`,
      findings: findings.map((f) => ({
        severity: f.severity,
        category: f.category ?? 'coherence',
        claim: f.claim ?? 'a finding',
      })),
      findingsOutcome: findings.length > 0 ? 'found' : 'clean',
    },
    ...(extra?.contextBlockId ? { contextBlockId: extra.contextBlockId } : {}),
    error: { kind: 'not_applicable' },
  };
}

/** A journal-record envelope with the given node ids in structuredReport.recorded[]. */
export function journalEnvelope(nodeIds: string[]): unknown {
  return {
    headline: `journal-record: ${nodeIds.length} node(s)`,
    results: [],
    batchTimings: { kind: 'not_applicable' },
    costSummary: { kind: 'not_applicable' },
    structuredReport: {
      summary: `recorded ${nodeIds.length}`,
      filesChanged: nodeIds.map((id) => `nodes/${id}.md`),
      recorded: nodeIds.map((id, i) => ({ learningIndex: i, op: 'create', ids: [id] })),
      failed: [],
    },
    error: { kind: 'not_applicable' },
  };
}
