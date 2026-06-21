import { REPO_STATUS } from '@/db/enums';

describe('db/enums', () => {
  it('REPO_STATUS is exactly cloned/pulling/error', () => {
    expect([...REPO_STATUS]).toEqual(['cloned', 'pulling', 'error']);
  });
});
