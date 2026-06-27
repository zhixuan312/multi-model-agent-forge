/**
 * Plan task refine prompt builder — constructs the 6-part prompt for
 * the MMA orchestration route when a user asks to refine a plan task.
 */

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

export function parsePlanRefineResponse(raw: string): PlanRefineResult {
  let cleaned = raw.trim();
  const codeBlockMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === 'object' && parsed !== null) {
      const chatReply = (parsed.chatReply ?? parsed.chat_reply ?? parsed.reply ?? '') as string;
      const updatedTaskBody = (parsed.updatedTaskBody ?? parsed.updated_task_body ?? parsed.taskBody ?? null) as string | null;
      if (chatReply) {
        return { chatReply, updatedTaskBody };
      }
    }
  } catch { /* not JSON — fall through */ }

  return { chatReply: raw.trim(), updatedTaskBody: null };
}
