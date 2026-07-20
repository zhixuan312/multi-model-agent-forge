'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Maximize2, Minimize2, Plus, Minus, RotateCcw, X } from 'lucide-react';
import { statusHex, edgeHex } from './graph-palette';
import {
  DEFAULT_LAYOUT, clamp, computeDegrees, labelRanks, layoutNodes, centerPositions, fitDistance,
  birthOrder, scaleBirths, ENTRANCE, wrapLines, relationBreakdown, ignite, flash, magnitude, mulberry32, project, collides, deepFieldPixel,
  type Vec3, type Box,
} from './graph-core';
import { useJournalNodeBody } from '@/components/forge/journal/journal-shell';
import { ProseBlock } from '@/components/patterns/prose-block';
import type { GraphNode, GraphEdge } from '@/journal/graph';

/**
 * The journal graph as a night sky. Each learning is a star whose magnitude comes from how
 * many other learnings connect to it; categories form constellations; relations are threads
 * of light strung between them.
 *
 * Rendered on a 2D canvas with our own perspective projection rather than a WebGL graph
 * library: at this scale (tens of nodes) it is cheaper, and it gives full control over the
 * things that actually make a graph readable — a silent sky when zoomed out, names that
 * resolve progressively as you approach, and collision-tested labels that never overlap.
 *
 * All geometry and choreography live in `graph-core.ts` (pure + unit-tested); this file is
 * the canvas driver and the interaction surface.
 */

const TAU = Math.PI * 2;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function hexA(hex: string, a: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
}

interface Star extends Vec3 {
  node: GraphNode; deg: number; mag: number; rank: number; birth: number;
  px: number; py: number; pk: number; pz: number; onScreen: boolean; r: number;
}

/**
 * The reading surfaces are aged vellum, not glass: the sky is the astronomer's subject,
 * and these are the chart laid over it. Mottling and foxing come from stacked radial
 * washes; the grain reuses the container's own noise filter, multiplied into the paper.
 */
const VELLUM = {
  background:
    'radial-gradient(112% 74% at 14% 6%,rgba(255,253,246,.92),transparent 58%),' +
    'radial-gradient(86% 66% at 88% 96%,rgba(178,152,106,.34),transparent 62%),' +
    'radial-gradient(38% 30% at 72% 22%,rgba(169,118,26,.13),transparent 68%),' +
    'radial-gradient(30% 26% at 20% 70%,rgba(154,61,20,.08),transparent 70%),' +
    'linear-gradient(168deg,#f3ead7 0%,#ece0c9 46%,#e3d5b8 100%)',
} as const;

const INK = '#211c16', INK_SOFT = '#4a4238', INK_FAINT = '#857a68';
const RUBRIC = '#9a3d14';           // headings in red, as a scribe would set them
const RULE = 'rgba(122,98,62,.32)';

/** Paper texture + the inner rule of a chart cartouche. Decoration only. */
function VellumSurface() {
  return (
    <>
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full opacity-[.17] mix-blend-multiply">
        <rect width="100%" height="100%" filter="url(#journal-graph-grain)" />
      </svg>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-[5px] rounded-[7px]"
        style={{ border: `1px solid ${RULE}` }}
      />
    </>
  );
}

/** A rubricated section label — small caps, wide tracking, struck through with a rule. */
function Rubric({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={`flex items-center gap-2.5 font-[family-name:var(--font-serif,Newsreader)] text-[11px] uppercase tracking-[.28em] ${className}`}
      style={{ color: RUBRIC }}
    >
      <span className="whitespace-nowrap">{children}</span>
      <span aria-hidden className="h-px flex-1" style={{ background: RULE }} />
    </p>
  );
}

/** One `## Context` / `## Consequences` block, set on the vellum. */
function Knowledge({ label, md }: { label: string; md: string }) {
  if (!md.trim()) return null;
  return (
    <section className="mt-6">
      <Rubric>{label}</Rubric>
      <ProseBlock
        variant="rail"
        className={
          'mt-2.5 prose-p:my-3 prose-p:text-[15px] prose-p:leading-[1.74] prose-p:text-[#3d362c] ' +
          'prose-li:my-1 prose-li:text-[15px] prose-li:leading-[1.7] prose-li:text-[#3d362c] prose-li:marker:text-[#9a3d14] ' +
          'prose-strong:text-[#211c16] prose-strong:font-semibold prose-headings:text-[#211c16] prose-a:text-[#9a3d14] ' +
          'prose-code:bg-[rgba(154,61,20,.1)] prose-code:text-[#8c3711] prose-code:text-[0.82em] ' +
          'prose-hr:border-[rgba(122,98,62,.3)]'
        }
      >
        {md}
      </ProseBlock>
    </section>
  );
}

export function JournalGraph3D({
  nodes, edges, onOpen,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onOpen: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onOpenRef = useRef(onOpen);
  // eslint-disable-next-line react-hooks/refs -- mirror the latest handler so the long-lived canvas listeners read it without re-subscribing
  onOpenRef.current = onOpen;

  const [full, setFull] = useState(false);
  // The *held* selection (a click), distinct from transient hover. In full screen this
  // drives the detail panel; inline it just keeps the compact card pinned.
  const [selected, setSelected] = useState<GraphNode | null>(null);

  // The camera lives in a ref: the loop mutates it each frame without re-rendering React.
  const cam = useRef<{ yaw: number; pitch: number; dist: number; tYaw: number; tPitch: number; tDist: number }>({
    yaw: 0.52, pitch: -0.16, dist: DEFAULT_LAYOUT.homeDist,
    tYaw: 0.52, tPitch: -0.16, tDist: DEFAULT_LAYOUT.homeDist,
  });
  const homeRef = useRef<number>(DEFAULT_LAYOUT.homeDist);
  const zoomBy = useCallback((f: number) => {
    cam.current.tDist = clamp(cam.current.tDist * f, DEFAULT_LAYOUT.minDist, DEFAULT_LAYOUT.maxDist);
  }, []);
  const resetView = useCallback(() => {
    cam.current.tYaw = 0.52; cam.current.tPitch = -0.16; cam.current.tDist = homeRef.current;
  }, []);

  /* ── full screen ────────────────────────────────────────────────────── */
  const toggleFull = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void el.requestFullscreen?.().catch(() => { /* denied — stay inline */ });
  }, []);
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  /* ── the sky: derived once per graph, never per frame ───────────────── */
  const sky = useMemo(() => {
    const deg = computeDegrees(nodes, edges);
    const ranks = labelRanks(nodes, deg);
    const pos = layoutNodes(nodes, edges);
    const { radius } = centerPositions(pos);
    const births = scaleBirths(birthOrder(nodes, edges, deg));
    const maxDeg = Math.max(1, ...[...deg.values()]);
    const stars: Star[] = nodes.map((n) => {
      const p = pos.get(n.id) ?? { x: 0, y: 0, z: 0 };
      const d = deg.get(n.id) ?? 0;
      return {
        ...p, node: n, deg: d, mag: magnitude(d, maxDeg),
        rank: ranks.get(n.id) ?? 0, birth: births.get(n.id) ?? 0,
        px: 0, py: 0, pk: 0, pz: 0, onScreen: false, r: 0,
      };
    });
    const byId = new Map(stars.map((s) => [s.node.id, s]));
    const links = edges
      .map((e) => ({ a: byId.get(e.source), b: byId.get(e.target), type: e.type }))
      .filter((l): l is { a: Star; b: Star; type: string } => !!l.a && !!l.b)
      .map((l) => ({ ...l, birth: Math.max(l.a.birth, l.b.birth) + ENTRANCE.linkLag }));
    const nbr = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
    for (const e of edges) {
      if (!nbr.has(e.source) || !nbr.has(e.target)) continue;
      nbr.get(e.source)!.add(e.target); nbr.get(e.target)!.add(e.source);
    }
    return { stars, links, nbr, radius };
  }, [nodes, edges]);

  const skyRef = useRef(sky);
  // eslint-disable-next-line react-hooks/refs -- the render loop reads the latest sky without re-subscribing
  skyRef.current = sky;
  const hoverRef = useRef<Star | null>(null);
  const heldRef = useRef<Star | null>(null);

  /* ── background starfield (independent of the graph) ────────────────── */
  const field = useMemo(() => {
    const rnd = mulberry32(99991);
    return Array.from({ length: 900 }, () => {
      const th = rnd() * TAU, ph = Math.acos(2 * rnd() - 1), R = 1000 + rnd() * 3100;
      return {
        x: Math.sin(ph) * Math.cos(th) * R, y: Math.cos(ph) * R * 0.82, z: Math.sin(ph) * Math.sin(th) * R,
        m: Math.pow(rnd(), 3.8), tw: rnd() * TAU, temp: rnd(),
      };
    });
  }, []);

  /** Select a star by id and turn the camera to face it — used by the detail panel. */
  const selectById = useCallback((id: string) => {
    const star = skyRef.current.stars.find((s) => s.node.id === id);
    if (!star) return;
    heldRef.current = star;
    setSelected(star.node);
    const c = cam.current;
    c.tYaw = Math.atan2(star.x, star.z);
    c.tPitch = clamp(Math.atan2(star.y, Math.hypot(star.x, star.z)), -1.05, 1.05);
    c.tDist = Math.min(c.tDist, 900);
  }, []);

  const clearSelection = useCallback(() => {
    heldRef.current = null; setSelected(null);
  }, []);

  // The panel shows the learning itself, not just its one-line frontmatter summary — the
  // index rows carry no bodies, so the Context / Consequences prose is fetched on selection.
  const body = useJournalNodeBody(full && selected ? selected.id : null);

  /** Everything this learning is connected to, with the relation and direction. */
  const relations = useMemo(() => {
    if (!selected) return [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return edges
      .filter((e) => e.source === selected.id || e.target === selected.id)
      .map((e) => {
        const outgoing = e.source === selected.id;
        const other = byId.get(outgoing ? e.target : e.source);
        return other ? { type: e.type, outgoing, node: other } : null;
      })
      .filter((r): r is { type: string; outgoing: boolean; node: GraphNode } => !!r);
  }, [selected, nodes, edges]);

  /* ── the deep field: a procedural nebula, painted once ──────────────── */
  const nebulaRef = useRef<HTMLCanvasElement | null>(null);
  const buildNebula = useCallback(() => {
    if (nebulaRef.current) return nebulaRef.current;
    const w = 900, h = 450;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    // A partial 2D context (jsdom, some embedded webviews) simply gets no nebula.
    if (!x || typeof x.createImageData !== 'function' || typeof x.putImageData !== 'function') return null;
    const im = x.createImageData(w, h), d = im.data;
    for (let py = 0; py < h; py++) {
      const v = py / (h - 1);
      for (let px = 0; px < w; px++) {
        const [r, g, b] = deepFieldPixel(px / (w - 1), v);
        const i = (py * w + px) * 4;
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      }
    }
    x.putImageData(im, 0, 0);
    nebulaRef.current = c;
    return c;
  }, []);

  /* ── render loop ────────────────────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, dpr = 1, focal = 900, raf = 0, t0: number | null = null;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      focal = clamp(W * 0.76, 660, 1080);
      // Home frames the whole sky at any node count and any viewport.
      const home = fitDistance(skyRef.current.radius, focal, Math.min(W, H));
      if (cam.current.tDist === homeRef.current) cam.current.tDist = home; // follow while at home
      homeRef.current = home;
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap);

    buildNebula();
    if (!reduce) cam.current.dist = DEFAULT_LAYOUT.maxDist * 0.88; // glide in on first paint
    cam.current.tDist = homeRef.current;

    const col2 = (s: Star) => statusHex(s.node.status);
    const draw = (now: number) => {
      const T = now / 1000;
      if (t0 === null) t0 = T;
      const elapsed = reduce ? 999 : T - t0;
      const c = cam.current;
      const focus = heldRef.current ?? hoverRef.current;

      if (!focus) c.tYaw += 0.00035;                       // idle drift
      c.yaw += (c.tYaw - c.yaw) * 0.085;
      c.pitch += (c.tPitch - c.pitch) * 0.085;
      c.dist += (c.tDist - c.dist) * 0.075;

      const camera = { yaw: c.yaw, pitch: c.pitch, dist: c.dist, focal };
      const vp = { w: W, h: H };

      const g = ctx.createRadialGradient(W * 0.5, H * 0.43, 0, W * 0.5, H * 0.46, Math.max(W, H) * 0.86);
      g.addColorStop(0, '#0a1322'); g.addColorStop(0.48, '#050a13'); g.addColorStop(1, '#01040a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      // the deep field — screen-blended and panned with the camera, so the sky encloses you
      const neb = nebulaRef.current;
      if (neb) {
        const sc = (H * 1.74) / neb.height, dw = neb.width * sc, dh = neb.height * sc;
        let ox = ((-c.yaw / TAU) * dw) % -dw;
        while (ox > 0) ox -= dw;
        while (ox < -dw) ox += dw;
        ox -= dw;
        const oy = H / 2 - dh / 2 + (c.pitch / 1.2) * (dh * 0.22);
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.86;
        for (let k = 0; k < Math.ceil(W / dw) + 3; k++) ctx.drawImage(neb, ox + k * dw, oy, dw, dh);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      // distant stars — tiny, bright, twinkling
      ctx.globalCompositeOperation = 'lighter';
      for (const s of field) {
        const p = project(s, camera, vp);
        if (!p || p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) continue;
        const depth = clamp(1 - p.z / 4300, 0, 1);
        const a = depth * (0.10 + s.m * 0.72) * (0.9 + 0.1 * Math.sin(T * 0.85 + s.tw));
        if (a < 0.015) continue;
        ctx.fillStyle = hexA(s.temp > 0.76 ? '#d7e5ff' : s.temp < 0.19 ? '#ffd9aa' : '#f5f2e9', a);
        ctx.beginPath(); ctx.arc(p.x, p.y, 0.22 + s.m * 1.05, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      const { stars, links, nbr } = skyRef.current;
      for (const s of stars) {
        const p = project(s, camera, vp);
        s.onScreen = !!p;
        if (p) { s.px = p.x; s.py = p.y; s.pk = p.k; s.pz = p.z; }
      }
      const hot = new Set<string>();
      if (focus) { hot.add(focus.node.id); nbr.get(focus.node.id)?.forEach((id) => hot.add(id)); }

      // constellation names — fade in below the silence threshold, recede as stars take over
      // threads — drawn as they are born, light gathering at each end
      ctx.lineCap = 'round';
      for (const l of links) {
        if (!l.a.onScreen || !l.b.onScreen) continue;
        const eb = ignite(l.birth, elapsed, ENTRANCE.ignite);
        if (eb <= 0) continue;
        const isHot = !!focus && (l.a.node.id === focus.node.id || l.b.node.id === focus.node.id);
        const depth = clamp(1 - ((l.a.pz + l.b.pz) / 2) / 2850, 0, 1);
        const a = (0.15 + depth * 0.28) * (!focus ? 1 : isHot ? 2.4 : 0.18) * eb;
        if (a < 0.008) continue;
        const gr = easeOut(eb);
        const x2 = l.a.px + (l.b.px - l.a.px) * gr, y2 = l.a.py + (l.b.py - l.a.py) * gr;
        const col = edgeHex(l.type);
        const lg = ctx.createLinearGradient(l.a.px, l.a.py, x2, y2);
        lg.addColorStop(0, hexA(col, Math.min(0.85, a * 1.45)));
        lg.addColorStop(0.5, hexA(col, Math.min(0.5, a * 0.6)));
        lg.addColorStop(1, hexA(col, Math.min(0.85, a * 1.45)));
        ctx.strokeStyle = lg;
        ctx.lineWidth = (isHot ? 1.55 : 0.86) * clamp((l.a.pk + l.b.pk) * 25, 0.65, 1.32);
        ctx.beginPath(); ctx.moveTo(l.a.px, l.a.py); ctx.lineTo(x2, y2); ctx.stroke();
      }

      // stars
      const order = stars.filter((s) => s.onScreen).sort((a, b) => b.pz - a.pz);
      for (const s of order) {
        const ig = ignite(s.birth, elapsed, ENTRANCE.ignite);
        if (ig <= 0) { s.r = 0; continue; }
        const fl = flash(s.birth, elapsed);
        const isFocus = focus?.node.id === s.node.id;
        const dim = !!focus && !hot.has(s.node.id);
        const depth = clamp(1 - s.pz / 2750, 0.18, 1);
        const scale = clamp(s.pk * 72, 0.62, 1.32);
        const col = statusHex(s.node.status);
        const R = (1.05 + s.mag * 3.35) * scale * (isFocus ? 1.18 : 1) * (0.5 + 0.5 * easeOut(ig)) * (1 + 0.45 * fl);
        const lum = 0.78 + s.mag * 0.22;
        const tw = 0.94 + 0.06 * Math.sin(T * 1.7 + s.rank * 2.399);
        const a = (0.56 + depth * 0.42) * lum * tw * (dim ? 0.12 : 1) * (0.25 + 0.75 * easeOut(ig)) * (1 + 1.05 * fl);
        s.r = R;

        ctx.globalCompositeOperation = 'lighter';
        const glow = R * (isFocus ? 5.2 * (1 + 0.06 * Math.sin(T * 2.4)) : 3.4);
        const rg = ctx.createRadialGradient(s.px, s.py, 0, s.px, s.py, glow);
        rg.addColorStop(0, hexA(col, (isFocus ? 0.40 : 0.24) * a));
        rg.addColorStop(0.22, hexA(col, 0.14 * a));
        rg.addColorStop(0.55, hexA(col, 0.045 * a));
        rg.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(s.px, s.py, glow, 0, TAU); ctx.fill();

        if (s.mag > 0.72 || isFocus) {           // diffraction spikes on the brightest
          const L = R * (isFocus ? 5.4 : 3.5), sa = (isFocus ? 0.32 : 0.15) * a, tk = Math.max(0.5, 0.42 * scale);
          for (const horiz of [true, false]) {
            const gsp = horiz
              ? ctx.createLinearGradient(s.px - L, s.py, s.px + L, s.py)
              : ctx.createLinearGradient(s.px, s.py - L, s.px, s.py + L);
            gsp.addColorStop(0, hexA(col, 0)); gsp.addColorStop(0.5, hexA('#fff4df', sa)); gsp.addColorStop(1, hexA(col, 0));
            ctx.fillStyle = gsp;
            if (horiz) ctx.fillRect(s.px - L, s.py - tk / 2, L * 2, tk);
            else ctx.fillRect(s.px - tk / 2, s.py - L, tk, L * 2);
          }
        }
        // white-hot core with the colour in the halo — what reads as a star, not a dot
        const body = ctx.createRadialGradient(s.px, s.py, 0, s.px, s.py, R);
        body.addColorStop(0, hexA('#ffffff', Math.min(0.95, a)));
        body.addColorStop(0.34, hexA('#fff2d9', Math.min(0.92, a * 0.9)));
        body.addColorStop(0.68, hexA(col, Math.min(0.9, a * 0.78)));
        body.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = body; ctx.beginPath(); ctx.arc(s.px, s.py, R, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }

      // Labels only on hover. A standing field of small text fights the sky and is hard to
      // read at any zoom; naming just the star under the cursor and what it touches keeps
      // the sky clean and makes the one thing you asked about unmistakable.
      const boxes: Box[] = [];
      const prio = (s: Star) => (focus?.node.id === s.node.id ? 1e5 : 0) - s.rank;
      const candidates = focus ? [...order].sort((x, y) => prio(y) - prio(x)) : [];
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const s of candidates) {
        if (s.r <= 0 || ignite(s.birth, elapsed, ENTRANCE.ignite) < 1) continue;
        const isFocus = focus?.node.id === s.node.id;
        if (!isFocus && !hot.has(s.node.id)) continue;

        // The star names itself and nothing more — the side card carries the prose and the
        // network shape, so nothing is ever printed twice. Neighbours get a bare title.
        const TITLE = isFocus ? 17 : 13;
        const META = 8.5, SUB = 11;
        const pad = isFocus ? 11 : 7;
        const maxW = isFocus ? 340 : 190;
        const titleFont = `400 ${TITLE}px "Newsreader", Georgia, serif`;
        const metaFont = '500 8.5px ui-monospace, SFMono-Regular, Consolas, monospace';
        const subFont = `italic 400 ${SUB}px "Newsreader", Georgia, serif`;

        ctx.font = titleFont;
        const title = wrapLines(s.node.title, maxW, isFocus ? 3 : 1, (t) => ctx.measureText(t).width);
        if (!title.length) continue;

        const meta = isFocus ? `${s.node.id} · ${(s.node.type ?? '').toUpperCase()}` : '';
        const hint = '', sub: string[] = [];

        const widthOf = (lines: string[], font: string) => {
          if (!lines.length) return 0;
          ctx.font = font;
          return Math.max(...lines.map((l) => ctx.measureText(l).width));
        };
        const inner = Math.max(
          widthOf(title, titleFont),
          widthOf(meta ? [meta] : [], metaFont),
          widthOf(hint ? [hint] : [], metaFont),
          widthOf(sub, subFont),
        );
        const lh = TITLE * 1.3, subLh = SUB * 1.38;
        const w = inner + pad * 2;
        const h = pad * 2 + title.length * lh
          + (meta ? META + 7 : 0)
          + (sub.length ? sub.length * subLh + 8 : 0)
          + (hint ? META + 9 : 0);

        const box = ([
          { x: s.px - w / 2, y: s.py - s.r - 13 - h, w, h },
          { x: s.px + 15 + s.r, y: s.py - h / 2, w, h },
          { x: s.px - w - 15 - s.r, y: s.py - h / 2, w, h },
          { x: s.px - w / 2, y: s.py + 14 + s.r, w, h },
        ] as Box[]).find((b) =>
          b.x > 6 && b.x + b.w < W - 6 && b.y > 6 && b.y + b.h < H - 6 &&
          (isFocus || !boxes.some((o) => collides(b, o))));
        if (!box) continue;
        boxes.push(box);

        // The focused star gets a small vellum label pinned beside it — the same paper the
        // reading surfaces are cut from, so the chart reads as one instrument.
        if (isFocus) {
          const pg = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h);
          pg.addColorStop(0, '#f3ead7'); pg.addColorStop(0.5, '#ece0c9'); pg.addColorStop(1, '#e2d4b6');
          ctx.fillStyle = pg;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') ctx.roundRect(box.x, box.y, box.w, box.h, 7);
          else ctx.rect(box.x, box.y, box.w, box.h);
          ctx.fill();
          ctx.strokeStyle = 'rgba(88,70,44,.55)'; ctx.lineWidth = 0.8; ctx.stroke();
          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(box.x + 4, box.y + 4, box.w - 8, box.h - 8, 4);
            ctx.strokeStyle = 'rgba(122,98,62,.34)'; ctx.lineWidth = 0.6; ctx.stroke();
          }
        }
        ctx.strokeStyle = hexA(col2(s), isFocus ? 0.32 : 0.13);
        ctx.lineWidth = 0.55;
        ctx.beginPath(); ctx.moveTo(s.px, s.py);
        ctx.lineTo(clamp(s.px, box.x + 8, box.x + box.w - 8), box.y > s.py ? box.y : box.y + box.h);
        ctx.stroke();

        const cx = box.x + box.w / 2;
        let y = box.y + pad;
        if (!isFocus) { ctx.shadowColor = 'rgba(0,0,0,.95)'; ctx.shadowBlur = 10; }
        ctx.font = titleFont;
        ctx.fillStyle = isFocus ? '#211c16' : hexA('#dfe4e9', 0.9);
        for (const line of title) { ctx.fillText(line, cx, y); y += lh; }
        ctx.shadowBlur = 0;

        if (meta) {
          ctx.font = metaFont;
          ctx.fillStyle = 'rgba(154,61,20,.92)';
          ctx.fillText(meta, cx, y); y += META + 7;
        }
        if (sub.length) {
          y += 8;
          ctx.font = subFont;
          ctx.fillStyle = 'rgba(178,186,196,.92)';
          for (const line of sub) { ctx.fillText(line, cx, y); y += subLh; }
          y -= 8;
        }
        if (hint) {
          ctx.font = metaFont;
          ctx.fillStyle = 'rgba(142,150,159,.8)';
          ctx.fillText(hint, cx, y + 2);
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    /* ── interaction ──────────────────────────────────────────────────── */
    let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
    let moved = 0;
    const pick = (mx: number, my: number): Star | null => {
      let best: Star | null = null, bd = 26;
      for (const s of skyRef.current.stars) {
        if (!s.onScreen || s.r <= 0) continue;
        const d = Math.hypot(s.px - mx, s.py - my);
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    };
    const at = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, yaw: cam.current.tYaw, pitch: cam.current.tPitch };
      moved = 0; canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        moved = Math.hypot(dx, dy);
        cam.current.tYaw = drag.yaw + dx * 0.0052;
        cam.current.tPitch = clamp(drag.pitch + dy * 0.0045, -1.15, 1.15);
        return;
      }
      const { x, y } = at(e);
      const hit = pick(x, y);
      if (hit !== hoverRef.current) {
        hoverRef.current = hit;
        canvas.style.cursor = hit ? 'pointer' : 'grab';
      }
    };
    const onUp = () => { drag = null; };
    const onLeave = () => { hoverRef.current = null; };
    const onClick = (e: MouseEvent) => {
      if (moved > 5) return;
      const { x, y } = at(e);
      const hit = pick(x, y);
      heldRef.current = hit;
      setSelected(hit ? hit.node : null);
    };
    const onDouble = (e: MouseEvent) => {
      const { x, y } = at(e);
      const hit = pick(x, y);
      if (hit) onOpenRef.current(hit.node.id);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.current.tDist = clamp(
        cam.current.tDist * Math.exp(e.deltaY * 0.00105), DEFAULT_LAYOUT.minDist, DEFAULT_LAYOUT.maxDist);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDouble);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDouble);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [field, buildNebula]);

  // The card is a CLICK affordance, not a hover one: hovering names the star on the canvas,
  // clicking pins its card. In full screen the reading panel supersedes it entirely.
  const card = full ? null : selected;
  const shape = useMemo(() => (card ? relationBreakdown(edges, card.id) : []), [card, edges]);
  const shapeTotal = shape.reduce((n, r) => n + r.count, 0);

  const lead = (body.phase === 'ready' ? body.node?.crux : null) ?? selected?.description ?? null;

  const btn = 'grid size-7 place-items-center rounded-[var(--r-sm)] border border-[rgba(216,183,121,.28)] bg-[rgba(10,16,28,.62)] text-[#d8b779] backdrop-blur transition-colors hover:border-[rgba(216,183,121,.7)] hover:text-[#f4e6c8]';

  return (
    <div
      ref={wrapRef}
      data-testid="journal-graph"
      className="relative h-full min-h-[420px] w-full overflow-hidden rounded-[var(--r-md)] bg-[#01040a]"
    >
      <canvas ref={canvasRef} className="block size-full cursor-grab" aria-label="Journal knowledge graph" />

      {/* atmosphere — cool/warm wash, film grain, then a vignette to seat the sky */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 mix-blend-screen"
        style={{
          background:
            'radial-gradient(58% 52% at 17% 30%,rgba(45,71,111,.12),transparent 72%),' +
            'radial-gradient(52% 48% at 82% 66%,rgba(121,70,83,.08),transparent 74%),' +
            'linear-gradient(180deg,rgba(23,38,65,.05),transparent 24%,transparent 76%,rgba(2,5,11,.28))',
        }}
      />
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full opacity-[.045] mix-blend-soft-light">
        <filter id="journal-graph-grain">
          <feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#journal-graph-grain)" />
      </svg>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(118% 92% at 50% 46%,transparent 50%,rgba(0,2,7,.28) 79%,rgba(0,1,5,.76) 100%)' }}
      />

      <div
        className="absolute top-3 flex items-center gap-1.5 transition-[right] duration-300"
        style={{ right: full && selected ? 'calc(34.5rem + 2.25rem)' : '.75rem' }}
      >
        <button type="button" className={btn} onClick={() => zoomBy(1 / 1.18)} aria-label="Zoom in"><Plus className="size-3.5" /></button>
        <button type="button" className={btn} onClick={() => zoomBy(1.18)} aria-label="Zoom out"><Minus className="size-3.5" /></button>
        <button type="button" className={btn} onClick={resetView} aria-label="Reset view"><RotateCcw className="size-3.5" /></button>
        <button
          type="button"
          className={btn}
          onClick={toggleFull}
          aria-label={full ? 'Exit full screen' : 'Enter full screen'}
          aria-pressed={full}
          data-testid="graph-fullscreen"
        >
          {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
      </div>


      {/* The sky names the star; this names everything the star cannot say for itself —
          where it came from, what it means, and how it sits in the network. */}
      {card ? (
        <div
          data-testid="graph-hover-card"
          className="pointer-events-none absolute bottom-4 left-4 w-[20rem] overflow-hidden rounded-[var(--r-md)] px-5 py-4 shadow-[0_18px_52px_rgba(0,0,0,.62)]"
          style={{ ...VELLUM, border: '1px solid rgba(88,70,44,.5)' }}
        >
          <VellumSurface />
          <div className="relative">
            <p
              className="flex items-center gap-2 font-[family-name:var(--font-serif,Newsreader)] text-[10.5px] uppercase tracking-[.26em]"
              style={{ color: RUBRIC }}
            >
              <span className="size-1.5 rounded-full" style={{ background: statusHex(card.status) }} />
              {card.status}{card.source ? ` · ${card.source}` : ''}
            </p>

            <p
              className="mt-3 font-[family-name:var(--font-serif,Newsreader)] text-[14px] italic leading-[1.68]"
              style={{ color: card.description ? INK_SOFT : INK_FAINT }}
            >
              {card.description ?? 'No summary recorded.'}
            </p>

            <div className="mt-3.5 pt-3" style={{ borderTop: `1px solid ${RULE}` }}>
              <p
                className="font-[family-name:var(--font-serif,Newsreader)] text-[10.5px] uppercase tracking-[.24em]"
                style={{ color: INK_FAINT }}
              >
                {shapeTotal ? `${shapeTotal} connection${shapeTotal === 1 ? '' : 's'}` : 'Unconnected'}
              </p>
              {shape.length ? (
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 font-[family-name:var(--font-serif,Newsreader)] text-[11px] uppercase tracking-[.16em]">
                  {shape.map((r) => (
                    <span key={r.type} style={{ color: edgeHex(r.type) }}>
                      {r.type.replace(/-/g, ' ')} <span style={{ color: INK }}>{r.count}</span>
                    </span>
                  ))}
                </p>
              ) : null}
            </div>

            <p
              className="mt-3.5 font-[family-name:var(--font-serif,Newsreader)] text-[10px] uppercase tracking-[.2em]"
              style={{ color: INK_FAINT }}
            >
              Double-click to open · full screen for detail
            </p>
          </div>
        </div>
      ) : null}

      {/* Full screen earns the room for a real reading panel: the whole learning,
          plus every thread it hangs on, navigable without leaving the sky. */}
      {full && selected ? (
        <aside
          data-testid="graph-detail-panel"
          aria-label={`Details for ${selected.title}`}
          className="absolute inset-y-4 right-4 z-10 flex w-[34.5rem] flex-col overflow-hidden rounded-[var(--r-md)] shadow-[0_22px_70px_rgba(0,0,0,.66)]"
          style={{
            ...VELLUM,
            border: '1px solid rgba(88,70,44,.5)',
            animation: 'journal-graph-panel-in .34s cubic-bezier(.22,1,.36,1) both',
          }}
        >
          <style>{'@keyframes journal-graph-panel-in{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:none}}'}</style>
          <VellumSurface />

          <header
            className="relative flex items-start justify-between gap-3 px-7 pb-5 pt-6"
            style={{ borderBottom: `1px solid ${RULE}` }}
          >
            <div className="min-w-0">
              <p
                className="font-[family-name:var(--font-serif,Newsreader)] text-[11px] uppercase tracking-[.3em]"
                style={{ color: RUBRIC }}
              >
                {selected.id}{selected.type ? ` · ${selected.type}` : ''}
              </p>
              <h2
                className="mt-2.5 font-[family-name:var(--font-serif,Newsreader)] text-[23px] leading-[1.32]"
                style={{ color: INK }}
              >
                {selected.title}
              </h2>
              <p
                className="mt-3 inline-flex items-center gap-2 font-[family-name:var(--font-serif,Newsreader)] text-[10.5px] uppercase tracking-[.26em]"
                style={{ color: INK_FAINT }}
              >
                <span className="size-1.5 rounded-full" style={{ background: statusHex(selected.status) }} />
                {selected.status}
              </p>
            </div>
            <button
              type="button"
              onClick={clearSelection}
              aria-label="Close details"
              data-testid="graph-detail-close"
              className="grid size-7 shrink-0 place-items-center rounded-[var(--r-sm)] transition-colors hover:bg-[rgba(154,61,20,.09)]"
              style={{ border: `1px solid ${RULE}`, color: RUBRIC }}
            >
              <X className="size-3.5" />
            </button>
          </header>

          <div className="relative min-h-0 flex-1 overflow-y-auto px-7 py-6">
            {lead ? (
              <p
                className="font-[family-name:var(--font-serif,Newsreader)] text-[16px] italic leading-[1.72]"
                style={{ color: INK_SOFT }}
              >
                {lead}
              </p>
            ) : null}

            {body.phase === 'loading' ? (
              <p
                className="mt-6 font-[family-name:var(--font-serif,Newsreader)] text-[11px] uppercase tracking-[.26em]"
                style={{ color: INK_FAINT }}
              >
                Loading…
              </p>
            ) : null}
            {body.phase === 'error' ? (
              <p className="mt-6 text-[15px] italic leading-relaxed" style={{ color: '#a33a2f' }}>
                Could not load this learning.
              </p>
            ) : null}
            {body.phase === 'ready' && body.node ? (
              <>
                <Knowledge label="Context" md={body.node.context} />
                <Knowledge label="Consequences" md={body.node.consequences} />
              </>
            ) : null}

            <div className="mt-8">
              <Rubric>Connections · {relations.length}</Rubric>
            </div>
            {relations.length ? (
              <ul className="mt-3 space-y-1">
                {relations.map((r) => (
                  <li key={`${r.node.id}-${r.type}-${r.outgoing ? 'o' : 'i'}`}>
                    <button
                      type="button"
                      onClick={() => selectById(r.node.id)}
                      className="w-full rounded-[var(--r-sm)] border border-transparent px-3 py-2.5 text-left transition-colors hover:border-[rgba(122,98,62,.32)] hover:bg-[rgba(154,61,20,.06)]"
                    >
                      <span
                        className="flex items-center gap-1.5 font-[family-name:var(--font-serif,Newsreader)] text-[10.5px] uppercase tracking-[.22em]"
                        style={{ color: edgeHex(r.type) }}
                      >
                        {r.outgoing ? '→' : '←'} {r.type.replace(/-/g, ' ')}
                      </span>
                      <span className="mt-1.5 flex items-start gap-2 text-[15px] leading-[1.56]" style={{ color: INK }}>
                        <span className="mt-[.44rem] size-1.5 shrink-0 rounded-full" style={{ background: statusHex(r.node.status) }} />
                        {r.node.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[15px] italic leading-relaxed" style={{ color: INK_FAINT }}>
                An island — nothing links here yet.
              </p>
            )}
          </div>

          <footer className="relative px-7 py-5" style={{ borderTop: `1px solid ${RULE}` }}>
            <button
              type="button"
              onClick={() => onOpenRef.current(selected.id)}
              data-testid="graph-detail-open"
              className="w-full rounded-[var(--r-sm)] bg-[rgba(154,61,20,.07)] px-3 py-2.5 font-[family-name:var(--font-serif,Newsreader)] text-[12px] uppercase tracking-[.28em] transition-colors hover:bg-[rgba(154,61,20,.14)]"
              style={{ border: '1px solid rgba(154,61,20,.36)', color: RUBRIC }}
            >
              Open this learning
            </button>
          </footer>
        </aside>
      ) : null}
    </div>
  );
}
