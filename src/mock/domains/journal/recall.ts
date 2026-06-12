import nodesSeed from '@/mock/seed/journal-nodes.json';
import type { JournalNode } from '@/journal/types';

/**
 * Mock for the journal-recall "money" endpoint (deferred until now). Instead of
 * calling MMA, we keyword-match the query against the seed nodes and synthesize a
 * recall envelope in MMA's real shape (`structuredReport.summary` + `findings[]`,
 * each finding's `evidence` embedding `\`NNNN\`` + `nodes/NNNN-x.md` citation
 * forms) so `parseRecallEnvelope` resolves sources exactly as it would live. The
 * synthesis is multi-paragraph — a lead, one paragraph per cited node, then a
 * closing take — to mirror the length of a real recall answer.
 */
const nodes = nodesSeed as JournalNode[];

const firstSentence = (s: string) => {
  const m = s.replace(/\s+/g, ' ').trim().match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : s).trim();
};
const firstParagraph = (s: string) => s.split('\n\n')[0]!.replace(/\s+/g, ' ').trim();

export function buildMockRecallEnvelope(query: string): { structuredReport: { summary: string; findings: unknown[] } } {
  const q = query.toLowerCase();
  const words = Array.from(new Set(q.split(/[^a-z0-9]+/).filter((w) => w.length >= 4)));

  const scored = nodes
    .map((n) => {
      const hay = `${n.title} ${n.tags.join(' ')} ${n.crux ?? ''} ${n.context} ${n.consequences}`.toLowerCase();
      const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      return { n, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const matched = scored.length > 0;
  const picks = (matched ? scored : nodes.slice(0, 3).map((n) => ({ n, score: 0 }))).slice(0, 4);

  const findings = picks.map(({ n }) => ({
    category: n.tags[0] ?? 'general',
    severity: 'info',
    claim: n.crux ?? n.title,
    evidence: `${firstParagraph(n.context)} (see \`${n.id}\` — ${n.filename})`,
    suggestion: firstParagraph(n.consequences),
  }));

  const lead = matched
    ? `The team journal carries ${picks.length} prior decision(s) that bear directly on this. The recorded stance is consistent across them, and the reasoning is worth restating before you act:`
    : `No decision matches your wording closely, but the closest recorded context is worth reading before you act:`;

  const body = picks.map(({ n }) => {
    const crux = n.crux ? `${n.crux} ` : '';
    return `**${n.title}** (\`${n.id}\`) — ${crux}${firstSentence(n.context)} The durable consequence: ${firstSentence(n.consequences)}`;
  });

  const close = matched
    ? `Taken together, the through-line is clear: ${(picks[0]!.n.crux ?? picks[0]!.n.title).replace(/\.$/, '')}. The same reasoning recurs across ${picks.length} recorded decisions, so treat it as settled team practice rather than an open question.`
    : `Treat the above as background rather than a direct answer — if this is a new area, it may be worth recording a fresh decision once you reach one.`;

  const summary = [lead, ...body, close].join('\n\n');

  return { structuredReport: { summary, findings } };
}
