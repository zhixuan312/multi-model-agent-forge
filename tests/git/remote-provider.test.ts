import { parseRemote, authPushUrl } from '@/git/remote-provider';

describe('parseRemote — provider detection', () => {
  it('parses GitHub https and ssh remotes', () => {
    expect(parseRemote('https://github.com/acme/widgets.git')).toEqual({ provider: 'github', host: 'github.com', owner: 'acme', repo: 'widgets' });
    expect(parseRemote('git@github.com:acme/widgets.git')).toEqual({ provider: 'github', host: 'github.com', owner: 'acme', repo: 'widgets' });
  });

  it('parses a deeply-nested self-managed GitLab remote (the lunch_vote case)', () => {
    const url = 'https://x-access-token@sgts.gitlab-dedicated.com/wog/gvt/ciooffice/cio-office-infra/cioo-automation/moh-products/bktest3.git';
    expect(parseRemote(url)).toEqual({
      provider: 'gitlab',
      host: 'sgts.gitlab-dedicated.com',
      projectPath: 'wog/gvt/ciooffice/cio-office-infra/cioo-automation/moh-products/bktest3',
    });
  });

  it('parses gitlab.com and ssh GitLab remotes', () => {
    expect(parseRemote('https://gitlab.com/group/sub/app.git')).toEqual({ provider: 'gitlab', host: 'gitlab.com', projectPath: 'group/sub/app' });
    expect(parseRemote('git@gitlab.com:group/app.git')).toEqual({ provider: 'gitlab', host: 'gitlab.com', projectPath: 'group/app' });
  });

  it('returns null for unsupported hosts', () => {
    expect(parseRemote('https://bitbucket.org/team/repo.git')).toBeNull();
    expect(parseRemote('not a url')).toBeNull();
  });
});

describe('authPushUrl — provider-specific authenticated push URL', () => {
  it('embeds the token per provider', () => {
    expect(authPushUrl({ provider: 'github', host: 'github.com', owner: 'a', repo: 'b' }, 'TKN'))
      .toBe('https://x-access-token:TKN@github.com/a/b.git');
    expect(authPushUrl({ provider: 'gitlab', host: 'sgts.gitlab-dedicated.com', projectPath: 'g/s/p' }, 'TKN'))
      .toBe('https://oauth2:TKN@sgts.gitlab-dedicated.com/g/s/p.git');
  });
});
