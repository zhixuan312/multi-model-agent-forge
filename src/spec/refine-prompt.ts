/**
 * Spec section refine prompt builder — constructs the prompt for the MMA main
 * orchestration route when a user @Forge's in a discussion.
 *
 * Follows Forge's standard six-section prompt format (Role · Task · Context · Input ·
 * Constraints · Output format), the same one `loops/main-orchestration.ts` names.
 *
 * Session lifecycle:
 * - First call: full spec context + section draft + all conversation
 * - Continuation: section draft only + messages since last Forge reply
 * - Forge returns: { chatReply, updatedSectionMd }
 */
import { parseLlmJson } from '@/lib/llm-json';

export interface RefinePromptInput {
  componentLabel: string;
  sectionHeadings: string[];
  componentDraftMd: string;
  messagesSinceLastForge: Array<{ sender: string; bodyMd: string }>;
  isFirstCall: boolean;
  fullSpecMd?: string;
}

export interface RefineResult {
  chatReply: string;
  updatedSectionMd: string | null;
  questions: string[];
}

/**
 * Extract messages since the last Forge reply — these are the new inputs
 * to process on this @Forge call.
 */
export function getMessagesSinceLastForge(
  messages: Array<{ sender: string; bodyMd: string }>,
): Array<{ sender: string; bodyMd: string }> {
  let lastForgeIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender === 'forge') {
      lastForgeIdx = i;
      break;
    }
  }
  return messages.slice(lastForgeIdx + 1);
}

/**
 * Build the refine call's prompt: the six sections split across `system` and `user`.
 */
export function buildRefinePrompt(input: RefinePromptInput): { system: string; user: string } {
  const headingList = input.sectionHeadings.map((h) => `  - ### ${h}`).join('\n');
  const system = `Role: You are a specification co-author refining the "${input.componentLabel}" component.

Task: Process the team's discussion and:
  1. Update the component draft to incorporate their feedback
  2. Give a brief chat reply confirming what you changed
  3. After updating, review the component — if there are gaps or ambiguities, ask clarifying questions

This component has these sections:
${headingList}

Constraints:
- Apply the team's feedback as stated — do not question what they told you
- Preserve all existing content that wasn't discussed — only modify what the team addressed
- Your chatReply should be concise — confirm what you changed
- Questions (if any) should be about gaps in the component, not about the feedback itself

Output format:
Return a JSON object with exactly three fields:
\`\`\`json
{
  "chatReply": "brief summary of what you changed",
  "updatedSectionMd": "the full component markdown with ALL ### section headings preserved",
  "questions": ["specific follow-up question 1"]
}
\`\`\`
- updatedSectionMd MUST start each section with its \`### Heading\` exactly as listed above
- Return ALL sections of this component, not just the ones you changed
- chatReply: only describes what you changed. Keep it short and factual
- questions: separate array for follow-up questions. Empty array if none
- Do NOT put questions in chatReply — they belong only in the questions array`;

  const contextParts: string[] = [];
  if (input.isFirstCall && input.fullSpecMd) {
    contextParts.push(`Context:\n\n--- Full Spec ---\n${input.fullSpecMd}\n--- End Full Spec ---`);
  }
  contextParts.push(`--- Current "${input.componentLabel}" Component Draft ---\n${input.componentDraftMd}\n--- End Component Draft ---`);

  const userMessages = input.messagesSinceLastForge
    .map((m) => `[${m.sender === 'forge' ? 'Forge' : 'Team member'}]: ${m.bodyMd}`)
    .join('\n\n');

  const user = `${contextParts.join('\n\n')}

Input: Team discussion to process:

${userMessages}`;

  return { system, user };
}

/**
 * Parse the MMA response into chatReply + updatedSectionMd.
 * Handles JSON, markdown-wrapped JSON, and plain text fallback.
 */
export function parseRefineResponse(raw: string): RefineResult {
  // No JSON, or JSON without a chatReply, means Forge answered in prose — show it as-is.
  const parsed = parseLlmJson<Record<string, unknown>>(raw);
  if (parsed && typeof parsed === 'object') {
    const chatReply = (parsed.chatReply ?? parsed.chat_reply ?? parsed.reply ?? '') as string;
    const updatedSectionMd = (parsed.updatedSectionMd ?? parsed.updated_section_md ?? parsed.sectionMd ?? parsed.section_md ?? null) as string | null;
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter((q: unknown): q is string => typeof q === 'string' && q.trim() !== '')
      : [];
    if (chatReply) {
      return { chatReply, updatedSectionMd, questions };
    }
  }

  return { chatReply: raw.trim(), updatedSectionMd: null, questions: [] };
}
