import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GitTokenForm } from '../../app/(app)/settings/team/GitTokenForm';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

describe('GitTokenForm', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockClear();
  });

  it('shows "not set" and reveals the token field on Edit', () => {
    render(<GitTokenForm tokenSet={false} />);
    expect(screen.getByText('not set')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit git token/i }));
    expect(screen.getByLabelText(/service token/i)).toBeInTheDocument();
  });

  it('PUTs the token to /api/connections and refreshes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    render(<GitTokenForm tokenSet />);
    fireEvent.click(screen.getByRole('button', { name: /edit git token/i }));
    fireEvent.change(screen.getByLabelText(/service token/i), { target: { value: 'ghp_secret' } });
    fireEvent.click(screen.getByRole('button', { name: /save token/i }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith('/api/connections', expect.objectContaining({ method: 'PUT' })),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

/**
 * The git token is the credential that clones every repository and opens every PR, and it
 * was the only one of the three with no way to check it.
 *
 * `POST /api/connections/validate` has always accepted `type: 'git'`, and `probeGit` has
 * always been implemented and tested — this card simply never called it, so the whole git
 * branch of that endpoint was unreachable from the app while MMA and OpenAI each had a
 * button in the identical `FormPanel`. A bad token surfaces much later as "execute finished
 * and no PR appeared".
 */
describe('GitTokenForm can check the token', () => {
  const openCard = async () => {
    render(<GitTokenForm tokenSet />);
    await userEvent.click(screen.getByRole('button', { name: /edit git token/i }));
  };

  afterEach(() => vi.unstubAllGlobals());

  it('offers a Validate control', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await openCard();
    expect(screen.getByRole('button', { name: /validate|check/i })).toBeInTheDocument();
  });

  it('sends the typed token so an admin can test before saving', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, detail: 'Token accepted by the git host.' })));
    vi.stubGlobal('fetch', fetchMock);
    await openCard();

    await userEvent.type(screen.getByLabelText(/service token/i), 'ghp_typed');
    await userEvent.click(screen.getByRole('button', { name: /validate|check/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(body).toEqual({ type: 'git', token: 'ghp_typed' });
  });

  it('omits the token when the field is empty, so the STORED one is checked', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, detail: 'ok' })));
    vi.stubGlobal('fetch', fetchMock);
    await openCard();

    await userEvent.click(screen.getByRole('button', { name: /validate|check/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(body).toEqual({ type: 'git' });
  });

  it('shows the reason a check failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, detail: 'The git host rejected this credential (HTTP 401).' }))));
    await openCard();

    await userEvent.click(screen.getByRole('button', { name: /validate|check/i }));
    expect(await screen.findByText(/rejected this credential/i)).toBeInTheDocument();
  });
});
