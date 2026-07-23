'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary for a throw in the ROOT layout itself (where a normal error.tsx can't catch).
 * It replaces the root layout, so it must render its own <html>/<body> and can't rely on the app's
 * global stylesheet — styles are inlined. Keeps the user on a readable page with a reload path
 * instead of the browser's raw "Application error" screen.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Global error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'ui-sans-serif, system-ui, sans-serif', background: '#faf8f5', color: '#2a2622' }}>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#6b6560', maxWidth: 360, margin: 0 }}>
            Forge hit an unexpected error and couldn’t render. Reloading usually clears it.
          </p>
          <button
            onClick={reset}
            style={{ cursor: 'pointer', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 500, background: '#a33a2f', color: '#fff' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
