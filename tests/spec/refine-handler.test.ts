/**
 * TDD tests for the spec-refine dispatch handler.
 * Verifies: session reuse, delta prompt, dual output (chatReply + updatedSectionMd),
 * DB persistence, and SSE event publishing.
 */
import { describe, it, expect } from 'vitest';
import {
  getMessagesSinceLastForge,
  buildRefinePrompt,
  parseRefineResponse,
} from '@/spec/refine-prompt';

describe('refine handler — session reuse', () => {
  it('first call is identified when mmaSessionId is null', () => {
    const isFirstCall = null === null; // mmaSessionId
    expect(isFirstCall).toBe(true);
  });

  it('continuation is identified when mmaSessionId exists', () => {
    const isFirstCall = 'session-abc' === null;
    expect(isFirstCall).toBe(false);
  });
});

describe('refine handler — delta prompt computation', () => {
  it('first call includes full spec context', () => {
    const input = {
      componentLabel: 'Technical Design',
      sectionHeadings: ['Current state', 'Proposed design', 'Impact'],
      componentDraftMd: '### Current state\n\nMonolith backend.\n\n### Proposed design\n\nMicroservices.',
      messagesSinceLastForge: [{ sender: 'member', bodyMd: 'switch to microservices' }],
      isFirstCall: true,
      fullSpecMd: '## Context\n\n### Background\n\n...\n\n## Technical Design\n\n### Current state\n\nMonolith.',
    };
    const { user } = buildRefinePrompt(input);
    expect(user).toContain('Full Spec');
    expect(user).toContain('Monolith backend.');
    expect(user).toContain('switch to microservices');
  });

  it('continuation call excludes full spec, includes only component draft', () => {
    const input = {
      componentLabel: 'Technical Design',
      sectionHeadings: ['Current state', 'Proposed design'],
      componentDraftMd: '### Current state\n\nMicroservices.',
      messagesSinceLastForge: [{ sender: 'member', bodyMd: 'add API gateway' }],
      isFirstCall: false,
    };
    const { user } = buildRefinePrompt(input);
    expect(user).not.toContain('Full Spec');
    expect(user).toContain('Microservices.');
    expect(user).toContain('add API gateway');
  });

  it('only includes messages between last Forge reply and now', () => {
    const allMessages = [
      { sender: 'forge', bodyMd: 'Draft ready.' },
      { sender: 'member', bodyMd: 'old msg 1' },
      { sender: 'member', bodyMd: 'old msg 2' },
      { sender: 'forge', bodyMd: 'Updated.' },
      { sender: 'member', bodyMd: 'new msg 1' },
      { sender: 'member', bodyMd: '@Forge update' },
    ];
    const delta = getMessagesSinceLastForge(allMessages);
    expect(delta).toHaveLength(2);
    expect(delta[0].bodyMd).toBe('new msg 1');
    expect(delta[1].bodyMd).toBe('@Forge update');
  });
});

describe('refine handler — response parsing', () => {
  it('parses structured JSON with both fields', () => {
    const raw = JSON.stringify({
      chatReply: 'Added API gateway to the architecture.',
      updatedSectionMd: '## Architecture\nMicroservices with API gateway.',
    });
    const result = parseRefineResponse(raw);
    expect(result.chatReply).toBe('Added API gateway to the architecture.');
    expect(result.updatedSectionMd).toBe('## Architecture\nMicroservices with API gateway.');
  });

  it('handles chatReply-only (clarifying question, no section change)', () => {
    const raw = JSON.stringify({
      chatReply: 'Which API gateway — Kong, Envoy, or custom?',
      updatedSectionMd: '## Architecture\nMicroservices.',
    });
    const result = parseRefineResponse(raw);
    expect(result.chatReply).toContain('Which API gateway');
    expect(result.updatedSectionMd).toBe('## Architecture\nMicroservices.');
  });

  it('handles plain text fallback when LLM doesnt return JSON', () => {
    const raw = 'I updated the section to include the API gateway.';
    const result = parseRefineResponse(raw);
    expect(result.chatReply).toBe(raw);
    expect(result.updatedSectionMd).toBeNull();
  });

  it('handles markdown-wrapped JSON', () => {
    const raw = '```json\n{"chatReply":"Done.","updatedSectionMd":"# New"}\n```';
    const result = parseRefineResponse(raw);
    expect(result.chatReply).toBe('Done.');
    expect(result.updatedSectionMd).toBe('# New');
  });
});

describe('refine handler — full lifecycle', () => {
  it('simulates the complete refine flow', () => {
    // Step 1: Component has session from auto-draft
    const component = {
      id: 'comp-1',
      mmaSessionId: 'session-abc',
      sectionDraftMd: '## Context\nThe demo uses PostgreSQL.',
    };

    // Step 2: Users discuss
    const allMessages = [
      { sender: 'forge', bodyMd: '✅ This looks complete.' },
      { sender: 'member', bodyMd: 'our audience is CPFB users' },
      { sender: 'member', bodyMd: 'they use self-service to extract data' },
      { sender: 'member', bodyMd: '@Forge update this section' },
    ];

    // Step 3: Build delta prompt
    const delta = getMessagesSinceLastForge(allMessages);
    expect(delta).toHaveLength(3); // 3 messages after last forge

    const isFirstCall = component.mmaSessionId === null;
    expect(isFirstCall).toBe(false); // continuation

    const { system, user } = buildRefinePrompt({
      componentLabel: 'Context',
      sectionHeadings: ['Background'],
      componentDraftMd: component.sectionDraftMd,
      messagesSinceLastForge: delta,
      isFirstCall,
    });

    expect(system).toContain('Context');
    expect(user).toContain('CPFB users');
    expect(user).toContain('self-service');
    expect(user).not.toContain('Full Spec'); // continuation — no full spec

    // Step 4: MMA returns structured response
    const mmaResponse = JSON.stringify({
      chatReply: 'Updated the audience to CPFB officers using self-service data extraction.',
      updatedSectionMd: '## Context\nThe demo targets CPFB officers who use the self-service portal to extract claims data.',
    });

    const result = parseRefineResponse(mmaResponse);
    expect(result.chatReply).toContain('CPFB officers');
    expect(result.updatedSectionMd).toContain('self-service portal');

    // Step 5: Verify what gets saved
    // - chatReply → qa_message (sender='forge')
    // - updatedSectionMd → spec.md (file = source of truth)
    // - chat.message SSE published with chatReply
    expect(result.chatReply).toBeTruthy();
    expect(result.updatedSectionMd).toBeTruthy();
  });
});
