import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { JournalGraph3D } from '@/components/forge/journal/JournalGraph3D';
import type { GraphNode, GraphEdge } from '@/journal/graph';

const nodes: GraphNode[] = [
  { id: '0001', status: 'adopted', title: 'Guard identity at the data layer', type: 'decision' },
  { id: '0002', status: 'superseded', title: 'Second learning', type: 'design' },
  { id: '0003', status: 'adopted', title: 'Third learning', type: 'design' },
];
const edges: GraphEdge[] = [
  { source: '0001', target: '0002', type: 'relates' },
  { source: '0002', target: '0003', type: 'refines' },
];

// jsdom has no canvas backend; a minimal 2D context stub lets the render loop run.
function stubCanvas() {
  const grad = { addColorStop: vi.fn() };
  const ctx = {
    setTransform: vi.fn(), fillRect: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(),
    arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    rect: vi.fn(), roundRect: vi.fn(), fillText: vi.fn(), measureText: () => ({ width: 40 }),
    createRadialGradient: () => grad, createLinearGradient: () => grad,
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: vi.fn(), drawImage: vi.fn(), globalAlpha: 1,
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    globalCompositeOperation: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0, lineCap: '',
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  return ctx;
}

/** Give jsdom a real viewport and skip the entrance animation, so one frame paints a full sky. */
function stubViewport(w = 900, h = 600) {
  Element.prototype.getBoundingClientRect = (() =>
    ({ x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}) })
  ) as unknown as typeof Element.prototype.getBoundingClientRect;
  window.matchMedia = ((q: string) => ({
    matches: q.includes('prefers-reduced-motion'), media: q, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(),
    removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** Pretend the browser granted full screen on the graph container. */
async function enterFullscreen() {
  const wrap = screen.getByTestId('journal-graph');
  Object.defineProperty(document, 'fullscreenElement', { value: wrap, configurable: true });
  await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
  return wrap;
}

/**
 * Click across the canvas until a star is hit. Star positions come from a seeded layout,
 * so this is deterministic — we just don't want the test hard-coding projected pixels.
 */
/** The learning the panel is currently about — read off its label, not its body (which lists neighbours too). */
function panelSubject() {
  const panel = screen.getByTestId('graph-detail-panel');
  const label = panel.getAttribute('aria-label') ?? '';
  return nodes.find((n) => label === `Details for ${n.title}`)!;
}

async function clickAStar() {
  const canvas = screen.getByLabelText('Journal knowledge graph');
  for (let y = 20; y < 600; y += 20) {
    for (let x = 20; x < 900; x += 20) {
      await act(async () => { fireEvent.click(canvas, { clientX: x, clientY: y }); });
      if (screen.queryByTestId('graph-detail-panel')) return true;
    }
  }
  return false;
}

beforeEach(() => {
  stubCanvas();
  stubViewport();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
});

describe('JournalGraph3D', () => {
  it('renders a canvas for the sky', () => {
    render(<JournalGraph3D nodes={nodes} edges={edges} onOpen={vi.fn()} />);
    expect(screen.getByLabelText('Journal knowledge graph')).toBeInTheDocument();
  });

  it('offers a full-screen control', () => {
    render(<JournalGraph3D nodes={nodes} edges={edges} onOpen={vi.fn()} />);
    const btn = screen.getByTestId('graph-fullscreen');
    expect(btn).toHaveAttribute('aria-label', 'Enter full screen');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('requests full screen on the graph container when clicked', () => {
    const requestFullscreen = vi.fn(() => Promise.resolve());
    Element.prototype.requestFullscreen = requestFullscreen as unknown as typeof Element.prototype.requestFullscreen;
    render(<JournalGraph3D nodes={nodes} edges={edges} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByTestId('graph-fullscreen'));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('exits full screen when already in it', () => {
    const exitFullscreen = vi.fn(() => Promise.resolve());
    const wrap = document.createElement('div');
    Object.defineProperty(document, 'fullscreenElement', { value: wrap, configurable: true });
    document.exitFullscreen = exitFullscreen as unknown as typeof document.exitFullscreen;
    render(<JournalGraph3D nodes={nodes} edges={edges} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByTestId('graph-fullscreen'));
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });

  it('exposes zoom and reset controls', () => {
    render(<JournalGraph3D nodes={nodes} edges={edges} onOpen={vi.fn()} />);
    expect(screen.getByLabelText('Zoom in')).toBeInTheDocument();
    expect(screen.getByLabelText('Zoom out')).toBeInTheDocument();
    expect(screen.getByLabelText('Reset view')).toBeInTheDocument();
  });

  it('renders without throwing for an empty graph', () => {
    expect(() => render(<JournalGraph3D nodes={[]} edges={[]} onOpen={vi.fn()} />)).not.toThrow();
  });

  describe('full-screen detail panel', () => {
    afterEach(() => {
      Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    });

    it('stays closed while the graph is inline, however a star is selected', async () => {
      render(<JournalGraph3D nodes={nodes} edges={edges} onOpen={vi.fn()} />);
      await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
      const canvas = screen.getByLabelText('Journal knowledge graph');
      for (let y = 20; y < 600; y += 40)
        for (let x = 20; x < 900; x += 40)
          await act(async () => { fireEvent.click(canvas, { clientX: x, clientY: y }); });
      expect(screen.queryByTestId('graph-detail-panel')).not.toBeInTheDocument();
    });

    it('opens with the full learning once a star is selected in full screen', async () => {
      render(<JournalGraph3D nodes={nodes} edges={edges} onOpen={vi.fn()} />);
      await enterFullscreen();
      await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
      expect(screen.queryByTestId('graph-detail-panel')).not.toBeInTheDocument();

      expect(await clickAStar()).toBe(true);
      const panel = screen.getByTestId('graph-detail-panel');
      // whichever star was hit, the panel shows that learning whole
      const shown = panelSubject();
      expect(shown).toBeDefined();
      expect(within(panel).getByRole('heading')).toHaveTextContent(shown.title);
      expect(panel.textContent).toContain(shown.id);
      expect(panel.textContent).toContain(shown.status);
    });

    it('lists what the learning connects to and lets you travel there', async () => {
      render(<JournalGraph3D nodes={nodes} edges={edges} onOpen={vi.fn()} />);
      await enterFullscreen();
      await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
      expect(await clickAStar()).toBe(true);

      const panel = screen.getByTestId('graph-detail-panel');
      expect(within(panel).getByText(/Connections ·/)).toBeInTheDocument();

      const before = panelSubject();
      const hop = within(panel).queryAllByRole('button').find((b) => /relates|refines/.test(b.textContent ?? ''));
      if (hop) {
        await act(async () => { fireEvent.click(hop); });
        expect(panelSubject().id).not.toBe(before.id); // the panel followed the thread
      }
    });

    it('opens the learning and closes on demand', async () => {
      const onOpen = vi.fn();
      render(<JournalGraph3D nodes={nodes} edges={edges} onOpen={onOpen} />);
      await enterFullscreen();
      await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
      expect(await clickAStar()).toBe(true);

      fireEvent.click(screen.getByTestId('graph-detail-open'));
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(nodes.map((n) => n.id)).toContain(onOpen.mock.calls[0][0]);

      await act(async () => { fireEvent.click(screen.getByTestId('graph-detail-close')); });
      expect(screen.queryByTestId('graph-detail-panel')).not.toBeInTheDocument();
    });
  });
});
