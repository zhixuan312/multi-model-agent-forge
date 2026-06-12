import 'dotenv/config'
import '@testing-library/jest-dom/vitest'

// jsdom shims for Radix UI primitives (shadcn). Radix measures elements and uses
// pointer-capture APIs that jsdom does not implement; provide no-op stand-ins so
// Checkbox/Switch/Dialog/DropdownMenu/Tooltip mount cleanly under test. Guarded by
// environment — many suites run under the `node` environment where `window` /
// `Element` are undefined.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false
    },
  })) as unknown as typeof window.matchMedia
}

if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
}
