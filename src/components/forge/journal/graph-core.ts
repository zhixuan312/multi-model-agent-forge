import type { GraphNode, GraphEdge } from '@/journal/graph';

/**
 * Pure geometry + choreography for the journal's night-sky graph. Everything here is
 * DOM-free and deterministic so the renderer stays a thin canvas driver and the hard
 * parts (layout, semantic zoom, entrance order) are unit-testable.
 *
 * The visual model is a star chart: each learning is a star whose magnitude comes from
 * how many other learnings it connects to, laid out as constellations by category.
 */

export interface Vec3 { x: number; y: number; z: number }
export interface Camera { yaw: number; pitch: number; dist: number; focal: number }
export interface Viewport { w: number; h: number }
export interface Projected { x: number; y: number; k: number; z: number }
export interface Box { x: number; y: number; w: number; h: number }

export const DEFAULT_LAYOUT = {
  seed: 20260720,
  /** Beyond this camera distance the sky is silent — no text of any kind. */
  labelFar: 1900,
  /** At this distance every star is named. */
  labelNear: 460,
  minDist: 420,
  maxDist: 2600,
  homeDist: 1450,
} as const;

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Small, fast, seeded PRNG — identical sequence for a given seed. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many edges touch each node. Edges to unknown ids are ignored. */
export function computeDegrees(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const deg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (!deg.has(e.source) || !deg.has(e.target)) continue;
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }
  return deg;
}

/**
 * Fixed reveal order for labels — by connectedness, ties broken by id. Computed from the
 * GRAPH ALONE (never the camera), so zooming only ever adds names and orbiting never
 * reshuffles them.
 */
export function labelRanks(nodes: GraphNode[], deg: Map<string, number>): Map<string, number> {
  const ordered = [...nodes].sort(
    (a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return new Map(ordered.map((n, i) => [n.id, i]));
}

/** Perceptual magnitude 0..1 — a curve, so the middle of the range spreads out visibly. */
export function magnitude(degree: number, maxDegree: number): number {
  if (maxDegree <= 0) return 0;
  return Math.pow(clamp(degree / maxDegree, 0, 1), 0.65);
}

/**
 * Deterministic 3D layout: categories are seeded as constellations on a sphere, then a
 * cooled force pass (repulsion + edge springs + cluster cohesion) settles them.
 */
export function layoutNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: { seed?: number; iterations?: number } = {},
): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  if (!nodes.length) return out;

  const rnd = mulberry32(opts.seed ?? DEFAULT_LAYOUT.seed);
  const iterations = opts.iterations ?? 520;

  const cats = [...new Set(nodes.map((n) => n.type ?? 'other'))].sort();
  const anchor = new Map<string, Vec3>();
  cats.forEach((c, k) => {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const y = cats.length === 1 ? 0 : 1 - (k / (cats.length - 1)) * 1.5;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * k;
    anchor.set(c, { x: Math.cos(th) * r * 420, y: y * 300, z: Math.sin(th) * r * 420 });
  });

  type P = Vec3 & { vx: number; vy: number; vz: number; cat: string };
  const pts: P[] = nodes.map((n) => {
    const cat = n.type ?? 'other';
    const a = anchor.get(cat)!;
    return {
      cat,
      x: a.x + (rnd() - 0.5) * 190,
      y: a.y + (rnd() - 0.5) * 190,
      z: a.z + (rnd() - 0.5) * 190,
      vx: 0, vy: 0, vz: 0,
    };
  });
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const links = edges
    .map((e) => ({ s: idx.get(e.source), t: idx.get(e.target) }))
    .filter((l): l is { s: number; t: number } => l.s !== undefined && l.t !== undefined && l.s !== l.t);

  for (let step = 0; step < iterations; step++) {
    const cool = 1 - step / iterations;
    const k = 0.05 * cool + 0.006;
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b++) {
        const A = pts[a], B = pts[b];
        const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
        const d2 = dx * dx + dy * dy + dz * dz || 0.01;
        const d = Math.sqrt(d2), rep = 26000 / d2;
        const ux = dx / d, uy = dy / d, uz = dz / d;
        A.vx -= ux * rep * k; A.vy -= uy * rep * k; A.vz -= uz * rep * k;
        B.vx += ux * rep * k; B.vy += uy * rep * k; B.vz += uz * rep * k;
      }
    }
    for (const l of links) {
      const A = pts[l.s], B = pts[l.t];
      const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
      const d = Math.hypot(dx, dy, dz) || 0.01;
      const f = (d - 150) * 0.03 * k * 14;
      const ux = dx / d, uy = dy / d, uz = dz / d;
      A.vx += ux * f; A.vy += uy * f; A.vz += uz * f;
      B.vx -= ux * f; B.vy -= uy * f; B.vz -= uz * f;
    }
    for (const p of pts) {
      const a = anchor.get(p.cat)!;
      p.vx += (a.x - p.x) * 0.006 * k * 14 - p.x * 0.0012 * k * 14;
      p.vy += (a.y - p.y) * 0.006 * k * 14 - p.y * 0.0012 * k * 14;
      p.vz += (a.z - p.z) * 0.006 * k * 14 - p.z * 0.0012 * k * 14;
      p.x += p.vx; p.y += p.vy; p.z += p.vz;
      p.vx *= 0.8; p.vy *= 0.8; p.vz *= 0.8;
    }
  }

  nodes.forEach((n, i) => out.set(n.id, { x: pts[i].x, y: pts[i].y, z: pts[i].z }));
  return out;
}


/**
 * Entrance order: breadth-first from each component's best-connected star, so the sky
 * ignites the way knowledge grows — an idea first, then its consequences, ring by ring.
 */
export function birthOrder(
  nodes: GraphNode[],
  edges: GraphEdge[],
  deg: Map<string, number>,
  opts: { start?: number; step?: number } = {},
): Map<string, number> {
  const start = opts.start ?? 0.3;
  const step = opts.step ?? 0.085;
  const nbr = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
  for (const e of edges) {
    if (!nbr.has(e.source) || !nbr.has(e.target)) continue;
    nbr.get(e.source)!.add(e.target);
    nbr.get(e.target)!.add(e.source);
  }
  const byDeg = (a: string, b: string) =>
    (deg.get(b) ?? 0) - (deg.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0);

  const seen = new Set<string>();
  const order: string[] = [];
  for (const root of [...nodes].map((n) => n.id).sort(byDeg)) {
    if (seen.has(root)) continue;
    seen.add(root);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift()!;
      order.push(id);
      for (const j of [...(nbr.get(id) ?? [])].sort(byDeg)) {
        if (!seen.has(j)) { seen.add(j); queue.push(j); }
      }
    }
  }
  return new Map(order.map((id, i) => [id, start + i * step]));
}

/** 0 → 1 over `dur` seconds once `elapsed` passes `birth`. */
/**
 * Centre the cloud on the origin and report its bounding radius. The category anchors
 * are biased upward on purpose (constellations overhead), so without this the whole
 * sky drifts off the top of the frame.
 */
export function centerPositions(positions: Map<string, Vec3>): { radius: number } {
  const pts = [...positions.values()];
  if (!pts.length) return { radius: 0 };
  const c = { x: 0, y: 0, z: 0 };
  for (const p of pts) { c.x += p.x; c.y += p.y; c.z += p.z; }
  c.x /= pts.length; c.y /= pts.length; c.z /= pts.length;
  const d: number[] = [];
  for (const p of pts) {
    p.x -= c.x; p.y -= c.y; p.z -= c.z;
    d.push(Math.hypot(p.x, p.y, p.z));
  }
  // Robust radius: frame the dense core, not the stray outliers — a handful of
  // far-flung islands shouldn't push the whole sky into the distance.
  d.sort((a, b) => a - b);
  return { radius: d[Math.min(d.length - 1, Math.floor(d.length * 0.88))] };
}

/**
 * The camera distance at which a cloud of `radius` fills `fill` of the viewport's
 * short side — so the home view frames the whole sky regardless of how many
 * learnings it holds. Clamped to the zoom range.
 */
export function fitDistance(
  radius: number,
  focal: number,
  vpMin: number,
  fill = 0.78,
  cfg = DEFAULT_LAYOUT,
): number {
  if (radius <= 0 || vpMin <= 0) return cfg.homeDist;
  return clamp(radius * focal / (fill * (vpMin / 2)), cfg.minDist, cfg.maxDist);
}

/**
 * The whole sky lights up over this many seconds: births are rescaled so the LAST star
 * finishes igniting exactly at the end, however many stars there are.
 */
export const ENTRANCE = { seconds: 5, ignite: 0.62, linkLag: 0.18 };

/** Rescale raw BFS birth times onto the entrance window. Order is preserved. */
export function scaleBirths(
  births: Map<string, number>,
  span: number = ENTRANCE.seconds,
  dur: number = ENTRANCE.ignite,
): Map<string, number> {
  const max = Math.max(0, ...births.values());
  const last = Math.max(0, span - dur);
  const k = max > 0 ? last / max : 0;
  return new Map([...births].map(([id, b]) => [id, b * k]));
}

/**
 * How a node sits in the network: its edges grouped by relation, commonest first
 * (ties broken by name so the order never shuffles between renders).
 */
export function relationBreakdown(edges: GraphEdge[], id: string): { type: string; count: number }[] {
  const tally = new Map<string, number>();
  for (const e of edges) {
    if (e.source !== id && e.target !== id) continue;
    if (e.source === e.target) continue;
    tally.set(e.type, (tally.get(e.type) ?? 0) + 1);
  }
  return [...tally]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/**
 * Greedy word wrap against a caller-supplied measurer (the canvas 2D context in the app,
 * a stub in tests — this file stays pure). Overflow past `maxLines` is ellipsised, and a
 * single word too long for the line is cut rather than allowed to run off the box.
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  maxLines: number,
  measure: (s: string) => number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= maxWidth || !line) { line = next; continue; }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);

  const used = lines.join(' ').split(/\s+/).filter(Boolean).length;
  if (used < words.length && lines.length) {
    let last = `${lines[lines.length - 1]}…`;
    while (last.length > 1 && measure(last) > maxWidth) last = `${last.slice(0, -2)}…`;
    lines[lines.length - 1] = last;
  }
  return lines;
}

export function ignite(birth: number, elapsed: number, dur = 0.62): number {
  const t = (elapsed - birth) / dur;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/** A brief flare as a star is born, peaking just after ignition. */
export function flash(birth: number, elapsed: number, dur = 0.62): number {
  const t = (elapsed - birth) / dur;
  if (t <= 0 || t >= 1.2) return 0;
  const d = t - 0.24;
  return Math.exp(-(d * d) / 0.016);
}



/** Perspective projection. Returns null when the point sits behind the camera. */
export function project(p: Vec3, cam: Camera, vp: Viewport): Projected | null {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const x1 = p.x * cy - p.z * sy, z1 = p.x * sy + p.z * cy;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const y1 = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp;
  const zc = z2 + cam.dist;
  if (zc < 44) return null;
  const k = cam.focal / zc;
  return { x: vp.w / 2 + x1 * k, y: vp.h / 2 + y1 * k, k, z: zc };
}

/** Axis-aligned overlap test, used to keep labels from colliding. */
export function collides(a: Box, b: Box, pad = 2): boolean {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

/* ── deep-field noise ──────────────────────────────────────────────────────
   Tileable value-noise + fBm, used to paint the nebula the graph floats in.
   Horizontally periodic (`mod` on x) so the sky wraps without a seam.        */

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (n: number, m: number) => ((n % m) + m) % m;

/** Value noise on a `px × py` lattice, periodic in x. */
export function valueNoise(u: number, v: number, px: number, py: number, salt: number): number {
  const x = u * px, y = v * py;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = fade(x - x0), ty = fade(y - y0);
  const a = hash2(wrap(x0, px), y0, salt), b = hash2(wrap(x0 + 1, px), y0, salt);
  const c = hash2(wrap(x0, px), y0 + 1, salt), d = hash2(wrap(x0 + 1, px), y0 + 1, salt);
  const ab = a + (b - a) * tx, cd = c + (d - c) * tx;
  return ab + (cd - ab) * ty;
}

/** Five octaves of value noise — the cloud structure of the deep field. */
export function fbm(u: number, v: number, salt: number): number {
  let sum = 0, amp = 0.54, norm = 0;
  for (let o = 0; o < 5; o++) {
    const f = 1 << o;
    sum += valueNoise(u, v, 8 * f, 5 * f, salt + o * 37) * amp;
    norm += amp;
    amp *= 0.53;
  }
  return sum / norm;
}

/**
 * Paint one pixel of the deep field: a warped galactic band with broad gas, bright
 * knots and dark dust lanes. Returns 0-255 RGB. Pure, so the look is testable and the
 * renderer only has to blit it.
 */
export function deepFieldPixel(u: number, v: number): [number, number, number] {
  const warp = fbm(u * 1.12, v * 1.15, 19) - 0.5;
  const center = 0.51 + 0.085 * Math.sin(u * Math.PI * 2 + 0.44) + 0.023 * Math.sin(u * Math.PI * 6 - 1.15);
  const dy = Math.abs(v - center + warp * 0.055);
  const broad = Math.exp(-(dy * dy) / 0.0205);
  const core = Math.exp(-(dy * dy) / 0.0027);
  const n1 = fbm(u * 2.2 + warp * 0.18, v * 2.35 - warp * 0.1, 67);
  const n2 = fbm(u * 6.4 - n1 * 0.12, v * 7.2 + n1 * 0.08, 131);
  const n3 = fbm(u * 14.0, v * 13.0, 211);
  const gas = broad * smoothstep(0.32, 0.79, n1 * 0.72 + n2 * 0.28) * (0.62 + n3 * 0.38);
  const knots = core * smoothstep(0.48, 0.82, n2) * (0.65 + n3 * 0.35);
  const lane = core * smoothstep(0.53, 0.76, fbm(u * 5.1 + 0.13, v * 7.8 - 0.09, 307));
  const halo = 0.2 * Math.exp(-((v - 0.48) * (v - 0.48)) / 0.18);
  let r = 3 + halo * 2 + gas * 19 + knots * 22;
  let g = 6 + halo * 3 + gas * 27 + knots * 16;
  let b = 13 + halo * 7 + gas * 43 + knots * 18;
  const warm = knots * smoothstep(0.54, 0.78, n1);
  r += warm * 22; g += warm * 9; b -= warm * 2;
  const cut = lane * (19 + 22 * n3);
  r -= cut * 0.7; g -= cut * 0.84; b -= cut;
  const edge = 0.82 + 0.18 * Math.sin(Math.PI * v);
  return [
    clamp(r * edge, 0, 255),
    clamp(g * edge, 0, 255),
    clamp(b * edge, 0, 255),
  ];
}
