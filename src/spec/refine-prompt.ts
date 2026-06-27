/**
 * Spec section refine prompt builder — constructs the 6-part prompt for
 * the MMA main orchestration route when a user @Forge's in a discussion.
 *
 * Session lifecycle:
 * - First call: full spec context + section draft + all conversation
 * - Continuation: section draft only + messages since last Forge reply
 * - Forge returns: { chatReply, updatedSectionMd }
 */

export interface RefinePromptInput {
  sectionLabel: string;
  sectionDraftMd: string;
  messagesSinceLastForge: Array<{ sender: string; bodyMd: string }>;
  isFirstCall: boolean;
  fullSpecMd?: string;
}

export interface RefineResult {
  chatReply: string;
  updatedSectionMd: string | null;
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
 * Build the 6-part structured prompt for the refine call.
 */
export function buildRefinePrompt(input: RefinePromptInput): { system: string; user: string } {
  const system = `Role: You are a specification co-author working on the "${input.sectionLabel}" section.

Task: Process the team's discussion and do two things:
  1. Give a conversational chat reply acknowledging their input and explaining what you changed
  2. Update the section draft to incorporate their feedback

Constraints:
- Keep the section's existing structure unless the team explicitly asks to change it
- Your chatReply should be concise — confirm what you changed, or ask a clarifying question if the feedback is unclear
- Do NOT guess if the feedback is ambiguous — ask instead
- Preserve all existing content that wasn't discussed — only modify what the team addressed

Output format:
Return a JSON object with exactly two fields:
  { "chatReply": "your conversational reply", "updatedSectionMd": "the full updated section markdown" }
If no section changes are needed (e.g. you're asking a clarifying question), return the current draft unchanged in updatedSectionMd.`;

  const contextParts: string[] = [];
  if (input.isFirstCall && input.fullSpecMd) {
    contextParts.push(`Context:\n\n--- Full Spec ---\n${input.fullSpecMd}\n--- End Full Spec ---`);
  }
  contextParts.push(`--- Current "${input.sectionLabel}" Section Draft ---\n${input.sectionDraftMd}\n--- End Section Draft ---`);

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
  // Strip markdown code block wrapper if present
  let cleaned = raw.trim();
  const codeBlockMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === 'object' && parsed !== null) {
      const chatReply = (parsed.chatReply ?? parsed.chat_reply ?? parsed.reply ?? '') as string;
      const updatedSectionMd = (parsed.updatedSectionMd ?? parsed.updated_section_md ?? parsed.sectionMd ?? parsed.section_md ?? null) as string | null;
      if (chatReply) {
        return { chatReply, updatedSectionMd };
      }
    }
  } catch { /* not JSON — fall through */ }

  return { chatReply: raw.trim(), updatedSectionMd: null };
}
