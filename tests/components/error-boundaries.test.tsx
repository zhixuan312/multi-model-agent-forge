// @vitest-environment jsdom
/**
 * A production error reaches the user with its message stripped.
 *
 * Next removes the message from a server-side throw before it crosses to the browser and
 * hands back a `digest` matching the one it wrote to the server log. That string is the only
 * handle anyone has on the failure. All three boundaries destructured `digest` from their
 * props and rendered none of it — so "Something went wrong" was the entire bug report, and
 * the identifier that would have correlated it travelled to the client and was dropped.
 */
import { render, screen } from '@testing-library/react';
import AppError from '@/../app/(app)/error';
import ProjectError from '@/../app/(app)/projects/[id]/error';
import GlobalError from '@/../app/global-error';

const withDigest = () => Object.assign(new Error('boom'), { digest: 'abc123def456' });

describe('error boundaries surface the digest', () => {
  it('the app-shell boundary shows it', () => {
    render(<AppError error={withDigest()} reset={() => {}} />);
    expect(screen.getByText(/abc123def456/)).toBeInTheDocument();
  });

  it('the project boundary shows it', () => {
    render(<ProjectError error={withDigest()} reset={() => {}} />);
    expect(screen.getByText(/abc123def456/)).toBeInTheDocument();
  });

  it('the root boundary shows it', () => {
    // `global-error` renders its own <html>/<body>; jsdom tolerates the nesting for the assertion.
    render(<GlobalError error={withDigest()} reset={() => {}} />);
    expect(screen.getByText(/abc123def456/)).toBeInTheDocument();
  });

  it('renders nothing extra when there is no digest (a client-side throw)', () => {
    render(<AppError error={new Error('boom')} reset={() => {}} />);
    expect(screen.queryByText(/Reference:/)).toBeNull();
  });

  it('still offers the retry', () => {
    render(<AppError error={withDigest()} reset={() => {}} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
