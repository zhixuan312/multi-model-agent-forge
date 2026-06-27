/**
 * TDD tests for the spec section refine prompt builder.
 * Tests the 6-part prompt structure, delta computation, and response parsing.
 */
import { describe, it, expect } from 'vitest';
import {
  buildRefinePrompt,
  parseRefineResponse,
  getMessagesSinceLastForge,
  type RefinePromptInput,
} from '@/spec/refine-prompt';

describe('getMessagesSinceLastForge', () => {
  it('returns all messages when Forge never replied', () => {
    const msgs = [
      { sender: 'member', bodyMd: 'hello' },
      { sender: 'member', bodyMd: 'world' },
    ];
    expect(getMessagesSinceLastForge(msgs)).toEqual([
      { sender: 'member', bodyMd: 'hello' },
      { sender: 'member', bodyMd: 'world' },
    ]);
  });

  it('returns only messages after the last Forge reply', () => {
    const msgs = [
      { sender: 'forge', bodyMd: 'draft ready' },
      { sender: 'member', bodyMd: 'old message' },
      { sender: 'forge', bodyMd: 'updated' },
      { sender: 'member', bodyMd: 'new message 1' },
      { sender: 'member', bodyMd: 'new message 2' },
    ];
    expect(getMessagesSinceLastForge(msgs)).toEqual([
      { sender: 'member', bodyMd: 'new message 1' },
      { sender: 'member', bodyMd: 'new message 2' },
    ]);
  });

  it('returns empty when last message is from Forge', () => {
    const msgs = [
      { sender: 'member', bodyMd: 'hello' },
      { sender: 'forge', bodyMd: 'done' },
    ];
    expect(getMessagesSinceLastForge(msgs)).toEqual([]);
  });
});

describe('buildRefinePrompt', () => {
  const baseInput: RefinePromptInput = {
    sectionLabel: 'Context',
    sectionDraftMd: '# Context\nThe demo uses PostgreSQL.',
    messagesSinceLastForge: [
      { sender: 'member', bodyMd: 'our target audience is CPFB users' },
      { sender: 'member', bodyMd: '@Forge update this section' },
    ],
    isFirstCall: true,
    fullSpecMd: '# Full Spec\n## Context\nThe demo...\n## Problem\nDependency...',
  };

  it('includes the 6-part structure on first call', () => {
    const { system, user } = buildRefinePrompt(baseInput);
    expect(system).toContain('Role:');
    expect(system).toContain('Task:');
    expect(system).toContain('Constraints:');
    expect(system).toContain('Output format:');
    expect(user).toContain('Context:');
    expect(user).toContain('Input:');
  });

  it('includes full spec context on first call', () => {
    const { user } = buildRefinePrompt(baseInput);
    expect(user).toContain('Full Spec');
    expect(user).toContain(baseInput.fullSpecMd!);
    expect(user).toContain(baseInput.sectionDraftMd);
  });

  it('includes only section draft on continuation', () => {
    const { user } = buildRefinePrompt({ ...baseInput, isFirstCall: false, fullSpecMd: undefined });
    expect(user).not.toContain('Full Spec');
    expect(user).toContain(baseInput.sectionDraftMd);
  });

  it('includes user messages in the input', () => {
    const { user } = buildRefinePrompt(baseInput);
    expect(user).toContain('our target audience is CPFB users');
    expect(user).toContain('@Forge update this section');
  });

  it('includes section label', () => {
    const { system } = buildRefinePrompt(baseInput);
    expect(system).toContain('Context');
  });

  it('specifies JSON output format with chatReply and updatedSectionMd', () => {
    const { system } = buildRefinePrompt(baseInput);
    expect(system).toContain('chatReply');
    expect(system).toContain('updatedSectionMd');
  });
});

describe('parseRefineResponse', () => {
  it('parses valid JSON response', () => {
    const raw = JSON.stringify({
      chatReply: 'Updated the audience to CPFB officers.',
      updatedSectionMd: '# Context\nThe demo targets CPFB officers.',
    });
    const result = parseRefineResponse(raw);
    expect(result.chatReply).toBe('Updated the audience to CPFB officers.');
    expect(result.updatedSectionMd).toBe('# Context\nThe demo targets CPFB officers.');
  });

  it('handles response wrapped in markdown code block', () => {
    const raw = '```json\n{"chatReply":"Done.","updatedSectionMd":"# Updated"}\n```';
    const result = parseRefineResponse(raw);
    expect(result.chatReply).toBe('Done.');
    expect(result.updatedSectionMd).toBe('# Updated');
  });

  it('falls back to full text as chatReply when JSON parsing fails', () => {
    const raw = 'I updated the section to reflect CPFB users.';
    const result = parseRefineResponse(raw);
    expect(result.chatReply).toBe(raw);
    expect(result.updatedSectionMd).toBeNull();
  });

  it('handles camelCase and snake_case keys', () => {
    const raw = JSON.stringify({
      chat_reply: 'Done.',
      updated_section_md: '# New content',
    });
    const result = parseRefineResponse(raw);
    expect(result.chatReply).toBe('Done.');
    expect(result.updatedSectionMd).toBe('# New content');
  });
});
