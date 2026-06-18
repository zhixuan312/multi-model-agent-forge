// @vitest-environment node
import { listPins, addPin, removePin, refreshPin } from '@/journal/pins-core';
import { createMockDb } from '../test-utils/mock-db';

const M = 'member-1';
const FINDING = { learning: 'L', context: 'C', relevance: 'high', nodeId: '0001', category: 'design', status: 'adopted' };
const pinRow = (over: Record<string, unknown> = {}) => ({
  id: 'pin-1', memberId: M, question: 'how does X work?', answerMd: 'A', findings: [FINDING],
  citationIds: ['0001'], journalLogCount: 5, answeredAt: new Date(), createdAt: new Date(), ...over,
});

describe('pins-core', () => {
  it('addPin inserts a row with the member + stamped log count + findings', async () => {
    const db = createMockDb({ 'insert:journal_pin': [pinRow()] });
    const pin = await addPin(M, { question: 'how does X work?', answerMd: 'A', findings: [FINDING], citationIds: ['0001'], journalLogCount: 5 }, { db });
    expect(pin.question).toBe('how does X work?');
    expect(pin.journalLogCount).toBe(5);
    expect(pin.findings).toEqual([FINDING]);
    expect(db._assertCalled('journal_pin', 'insert')).toBe(true);
  });

  it('listPins returns the member rows', async () => {
    const db = createMockDb({ 'select:journal_pin': [pinRow(), pinRow({ id: 'pin-2' })] });
    expect(await listPins(M, { db })).toHaveLength(2);
  });

  it('removePin: owner row → removed; missing/non-owner → not_found', async () => {
    const ok = createMockDb({ 'delete:journal_pin': [{ id: 'pin-1' }] });
    expect((await removePin(M, 'pin-1', { db: ok })).kind).toBe('removed');
    const none = createMockDb({ 'delete:journal_pin': [] });
    expect((await removePin(M, 'pin-x', { db: none })).kind).toBe('not_found');
  });

  it('refreshPin: owner row → refreshed cache; missing/non-owner → not_found', async () => {
    const ok = createMockDb({ 'update:journal_pin': [pinRow({ answerMd: 'A2', journalLogCount: 9 })] });
    const r = await refreshPin(M, 'pin-1', { answerMd: 'A2', findings: [FINDING], citationIds: ['0002'], journalLogCount: 9 }, { db: ok });
    expect(r.kind).toBe('refreshed');
    if (r.kind === 'refreshed') expect(r.pin.journalLogCount).toBe(9);
    const none = createMockDb({ 'update:journal_pin': [] });
    expect((await refreshPin(M, 'pin-x', { answerMd: 'x', findings: [], citationIds: [], journalLogCount: 1 }, { db: none })).kind).toBe('not_found');
  });
});
