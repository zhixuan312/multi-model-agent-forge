/**
 * Browser download helpers shared by the export UI. Fetch a route, turn the
 * response into a Blob, and trigger a save. Kept separate so the components stay
 * presentational + testable.
 */

/** Trigger a browser "save as" for a Blob with a filename. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Best-effort filename from a Content-Disposition header. */
export function fileNameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const m = /filename="?([^";]+)"?/.exec(header);
  return m ? m[1] : fallback;
}

/** GET a download route and save it. Throws with the route error code on failure. */
export async function downloadGet(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw await routeError(res);
  const blob = await res.blob();
  saveBlob(blob, fileNameFromDisposition(res.headers.get('content-disposition'), fallbackName));
}

/** POST a download route (JSON body) and save it. */
export async function downloadPost(
  url: string,
  body: unknown,
  fallbackName: string,
): Promise<{ included?: string[] }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw await routeError(res);
  const included = res.headers.get('x-bundle-included');
  const blob = await res.blob();
  saveBlob(blob, fileNameFromDisposition(res.headers.get('content-disposition'), fallbackName));
  return { included: included ? included.split(',').filter(Boolean) : undefined };
}

async function routeError(res: Response): Promise<Error> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(data.error ?? `Request failed (${res.status}).`);
}
