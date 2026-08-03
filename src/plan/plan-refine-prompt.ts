/**
 * Plan task refine prompt builder — constructs the prompt for the MMA orchestration
 * route when a user asks to refine a plan task.
 *
 * Follows Forge's standard six-section prompt format (Role · Task · Context · Input ·
 * Constraints · Output format), the same one `loops/main-orchestration.ts` names.
 */
import { parseLlmJson } from '@/lib/llm-json';

export interface PlanRefinePromptInput {
  taskTitle: string;
  taskBody: string;
  userMessage: string;
  specMd?: string;
}

export interface PlanRefineResult {
  chatReply: string;
  updatedTaskBody: string | null;
}

export function buildPlanRefinePrompt(input: PlanRefinePromptInput): { system: string; user: string } {
  const system = `Role: You are a plan task refiner for Forge, a collaborative SDLC platform. You refine individual implementation tasks based on team feedback.

Task: Revise the given plan task to address the team's feedback. Return the FULL updated task body and a brief chat reply confirming what you changed.

Constraints:
- Apply the feedback as stated — do not question the team's direction
- Maintain the task's existing structure (Files, Steps, test commands, commit message)
- Preserve all content not touched by the feedback
- Keep the task TDD-structured: failing test → implementation → pass → commit
- Write in proper markdown: ### subheadings, **bold** for key terms, \`code\` for paths and commands

Output format:
Return a JSON object with exactly two fields:
\`\`\`json
{ "chatReply": "<brief summary of what you changed>", "updatedTaskBody": "<the full revised task body>" }
\`\`\`
- chatReply: concise summary of changes made
- updatedTaskBody: the COMPLETE task body after revision (not a diff)`;

  const parts: string[] = [];
  if (input.specMd) {
    parts.push(`Context: This task is part of a plan derived from the following specification.\n\n--- Specification ---\n${input.specMd}\n--- End Specification ---`);
  }
  parts.push(`Input:\n\n--- Task: ${input.taskTitle} ---\n${input.taskBody}\n--- End Task ---`);
  parts.push(`\n--- Team Feedback ---\n${input.userMessage}\n--- End Feedback ---`);

  return { system, user: parts.join('\n\n') };
}

/** The first of these that is a non-empty string, else null. Guards the `as string` casts
 *  this used to make: a non-string `updatedTaskBody` reached `replaceTaskSection`, whose
 *  `newBody.trim()` would throw on anything but a string — and it is written to plan.md. */
function firstString(...values: unknown[]): string | null {
  for (const v of values) if (typeof v === 'string' && v.trim() !== '') return v;
  return null;
}

export function parsePlanRefineResponse(raw: string): PlanRefineResult {
  // No JSON at all means Forge answered in prose — show it as-is.
  const parsed = parseLlmJson<Record<string, unknown>>(raw);
  if (parsed && typeof parsed === 'object') {
    const chatReply = firstString(parsed.chatReply, parsed.chat_reply, parsed.reply);
    const updatedTaskBody = firstString(parsed.updatedTaskBody, parsed.updated_task_body, parsed.taskBody);
    // Gated on `chatReply` alone before, so a response carrying a full revised task body
    // with an empty covering note was thrown away ENTIRELY — the revision discarded, and
    // the raw JSON shown to the user as the chat message. A revision with no note is still
    // a revision; the handler already supplies the note when there isn't one.
    if (chatReply || updatedTaskBody) {
      return { chatReply: chatReply ?? '', updatedTaskBody };
    }
  }

  return { chatReply: raw.trim(), updatedTaskBody: null };
}
