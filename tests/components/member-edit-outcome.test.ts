import { memberEditOutcome } from '../../app/(app)/settings/members/MemberTable';

// QA F10 — a member edit is two sequential writes (role PATCH, then password POST).
describe('memberEditOutcome', () => {
  it('both succeed → refresh + close, no error', () => {
    expect(memberEditOutcome({ roleChanged: true, passwordError: null }))
      .toEqual({ error: null, refresh: true, done: true });
  });

  it('role committed then password FAILED → refresh (not stale) + reports the role changed', () => {
    const o = memberEditOutcome({ roleChanged: true, passwordError: 'too weak' });
    expect(o.refresh).toBe(true);            // table must reflect the committed role
    expect(o.done).toBe(false);              // keep the form open to retry the password
    expect(o.error).toMatch(/role updated/i);
    expect(o.error).toContain('too weak');
  });

  it('no role change, password failed → plain error, no refresh', () => {
    expect(memberEditOutcome({ roleChanged: false, passwordError: 'too weak' }))
      .toEqual({ error: 'too weak', refresh: false, done: false });
  });
});
