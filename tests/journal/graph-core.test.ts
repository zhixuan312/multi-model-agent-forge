import {
  mulberry32,
  computeDegrees,
  labelRanks,
  layoutNodes,
  birthOrder,
  scaleBirths,
  wrapLines,
  relationBreakdown,
  ENTRANCE,
  project,
  collides,
  ignite,
  magnitude,
  smoothstep,
  fbm,
  valueNoise,
  deepFieldPixel,
  DEFAULT_LAYOUT,
} from '@/components/forge/journal/graph-core';
import type { GraphNode, GraphEdge } from '@/journal/graph';

const nodes: GraphNode[] = [
  { id: '0001', status: 'adopted', title: 'Hub of everything', type: 'decision' },
  { id: '0002', status: 'adopted', title: 'Second', type: 'design' },
  { id: '0003', status: 'superseded', title: 'Third', type: 'design' },
  { id: '0004', status: 'dropped', title: 'Leaf', type: 'style' },
  { id: '0005', status: 'adopted', title: 'Island', type: 'process' },
];
const edges: GraphEdge[] = [
  { source: '0001', target: '0002', type: 'relates' },
  { source: '0001', target: '0003', type: 'refines' },
  { source: '0001', target: '0004', type: 'relates' },
  { source: '0002', target: '0003', type: 'depends-on' },
];

describe('journal graph core', () => {
  describe('mulberry32 (seeded RNG)', () => {
    it('is deterministic for a given seed', () => {
      const a = mulberry32(42), b = mulberry32(42);
      const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
      expect(seqA).toEqual(seqB);
    });
    it('differs across seeds and stays in [0,1)', () => {
      const a = mulberry32(1), b = mulberry32(2);
      expect(a()).not.toBe(b());
      const r = mulberry32(7);
      for (let i = 0; i < 50; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
    });
  });

  describe('computeDegrees', () => {
    it('counts every incident edge', () => {
      const d = computeDegrees(nodes, edges);
      expect(d.get('0001')).toBe(3);
      expect(d.get('0002')).toBe(2);
      expect(d.get('0003')).toBe(2);
      expect(d.get('0004')).toBe(1);
      expect(d.get('0005')).toBe(0); // island
    });
    it('ignores edges referencing unknown nodes', () => {
      const d = computeDegrees(nodes, [{ source: '0001', target: 'nope', type: 'relates' }]);
      expect(d.get('0001')).toBe(0);
    });
  });

  describe('labelRanks', () => {
    it('ranks the best-connected node first (rank 0)', () => {
      const r = labelRanks(nodes, computeDegrees(nodes, edges));
      expect(r.get('0001')).toBe(0);
      expect(r.get('0005')).toBe(nodes.length - 1); // island last
    });
    it('is stable — ties break by id, so the order never shuffles', () => {
      const d = computeDegrees(nodes, edges);
      expect(labelRanks(nodes, d)).toEqual(labelRanks([...nodes].reverse(), d));
    });
  });

  describe('layoutNodes', () => {
    it('is deterministic — the same graph yields the identical sky', () => {
      const a = layoutNodes(nodes, edges), b = layoutNodes(nodes, edges);
      for (const n of nodes) expect(a.get(n.id)).toEqual(b.get(n.id));
    });
    it('positions every node with finite coordinates', () => {
      const p = layoutNodes(nodes, edges);
      for (const n of nodes) {
        const v = p.get(n.id)!;
        expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
      }
    });
    it('separates nodes rather than collapsing them to a point', () => {
      const p = layoutNodes(nodes, edges);
      const a = p.get('0001')!, b = p.get('0002')!;
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(10);
    });
    it('handles a single node and an empty graph without throwing', () => {
      expect(() => layoutNodes([nodes[0]], [])).not.toThrow();
      expect(layoutNodes([], []).size).toBe(0);
    });
  });

  describe('birthOrder (entrance choreography)', () => {
    it('ignites the best-connected star first', () => {
      const b = birthOrder(nodes, edges, computeDegrees(nodes, edges));
      const hub = b.get('0001')!;
      for (const n of nodes) if (n.id !== '0001') expect(b.get(n.id)!).toBeGreaterThan(hub);
    });
    it('gives every node a birth time, including disconnected ones', () => {
      const b = birthOrder(nodes, edges, computeDegrees(nodes, edges));
      for (const n of nodes) expect(typeof b.get(n.id)).toBe('number');
    });
    it('reaches neighbours before strangers (breadth first)', () => {
      const b = birthOrder(nodes, edges, computeDegrees(nodes, edges));
      expect(b.get('0004')!).toBeLessThan(b.get('0005')!); // hub neighbour before the island
    });
  });

  describe('scaleBirths (5-second entrance)', () => {
    const raw = () => birthOrder(nodes, edges, computeDegrees(nodes, edges));

    it('lands the last star fully lit exactly at the end of the window', () => {
      const b = scaleBirths(raw());
      const last = Math.max(...b.values());
      expect(last + ENTRANCE.ignite).toBeCloseTo(ENTRANCE.seconds, 6);
    });
    it('has every star lit by the end, and none before the start', () => {
      const b = scaleBirths(raw());
      for (const v of b.values()) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(ignite(v, ENTRANCE.seconds, ENTRANCE.ignite)).toBe(1);
      }
    });
    it('leaves the hub-first order untouched', () => {
      const before = raw(), after = scaleBirths(before);
      const order = (m: Map<string, number>) => [...m].sort((x, y) => x[1] - y[1]).map(([id]) => id);
      expect(order(after)).toEqual(order(before));
    });
    it('honours a custom span and survives a single-star sky', () => {
      expect(Math.max(...scaleBirths(raw(), 10).values()) + ENTRANCE.ignite).toBeCloseTo(10, 6);
      const one = new Map([['a', 0]]);
      expect(scaleBirths(one).get('a')).toBe(0);
    });
  });

  describe('relationBreakdown', () => {
    it('groups a node\'s edges by relation, commonest first', () => {
      expect(relationBreakdown(edges, '0001')).toEqual([
        { type: 'relates', count: 2 },
        { type: 'refines', count: 1 },
      ]);
    });
    it('counts inbound and outbound alike', () => {
      expect(relationBreakdown(edges, '0003')).toEqual([
        { type: 'depends-on', count: 1 },
        { type: 'refines', count: 1 },
      ]);
    });
    it('returns nothing for an island or an unknown id', () => {
      expect(relationBreakdown(edges, '0005')).toEqual([]);
      expect(relationBreakdown(edges, 'nope')).toEqual([]);
    });
    it('ignores self-edges', () => {
      expect(relationBreakdown([{ source: 'a', target: 'a', type: 'relates' }], 'a')).toEqual([]);
    });
  });

  describe('wrapLines', () => {
    const measure = (str: string) => str.length * 10; // 10px per character

    it('keeps a short line whole', () => {
      expect(wrapLines('one two', 200, 2, measure)).toEqual(['one two']);
    });
    it('breaks on words at the width', () => {
      expect(wrapLines('aaa bbb ccc', 70, 3, measure)).toEqual(['aaa bbb', 'ccc']);
    });
    it('ellipsises what will not fit in the line budget', () => {
      const out = wrapLines('aaa bbb ccc ddd', 70, 1, measure);
      expect(out).toHaveLength(1);
      expect(out[0].endsWith('…')).toBe(true);
    });
    it('never exceeds the line budget', () => {
      expect(wrapLines('a b c d e f g h i j k', 30, 2, measure).length).toBeLessThanOrEqual(2);
    });
    it('keeps an over-long single word rather than looping forever', () => {
      expect(wrapLines('supercalifragilistic', 30, 2, measure)).toEqual(['supercalifragilistic']);
    });
    it('returns nothing for empty or blank text', () => {
      expect(wrapLines('', 100, 2, measure)).toEqual([]);
      expect(wrapLines('   ', 100, 2, measure)).toEqual([]);
    });
  });

  describe('project', () => {
    const cam = { yaw: 0, pitch: 0, dist: 1000, focal: 900 };
    const vp = { w: 800, h: 600 };
    it('places the origin at the viewport centre', () => {
      const p = project({ x: 0, y: 0, z: 0 }, cam, vp)!;
      expect(p.x).toBeCloseTo(400);
      expect(p.y).toBeCloseTo(300);
    });
    it('returns null for points behind the camera', () => {
      expect(project({ x: 0, y: 0, z: -5000 }, cam, vp)).toBeNull();
    });
    it('scales nearer points larger (the camera looks down +z, so -z is nearer)', () => {
      const near = project({ x: 0, y: 0, z: -400 }, cam, vp)!;
      const far = project({ x: 0, y: 0, z: 400 }, cam, vp)!;
      expect(near.k).toBeGreaterThan(far.k);
      expect(near.z).toBeLessThan(far.z);
    });
    it('yaw rotates the scene', () => {
      const a = project({ x: 100, y: 0, z: 0 }, cam, vp)!;
      const b = project({ x: 100, y: 0, z: 0 }, { ...cam, yaw: Math.PI / 2 }, vp)!;
      expect(a.x).not.toBeCloseTo(b.x);
    });
  });

  describe('collides', () => {
    it('detects overlap and clears separated boxes', () => {
      const a = { x: 0, y: 0, w: 10, h: 10 };
      expect(collides(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
      expect(collides(a, { x: 40, y: 40, w: 10, h: 10 })).toBe(false);
    });
  });

  describe('deep field (nebula noise)', () => {
    it('smoothstep clamps and eases between the edges', () => {
      expect(smoothstep(0, 1, -1)).toBe(0);
      expect(smoothstep(0, 1, 2)).toBe(1);
      expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
    });
    it('fbm is deterministic and bounded in 0..1', () => {
      expect(fbm(0.3, 0.7, 19)).toBe(fbm(0.3, 0.7, 19));
      for (let i = 0; i < 40; i++) {
        const v = fbm(i / 40, (i * 7 % 40) / 40, 67);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });
    it('value noise wraps horizontally, so the sky has no seam', () => {
      for (const v of [0.2, 0.5, 0.8]) {
        expect(valueNoise(0, v, 8, 5, 67)).toBeCloseTo(valueNoise(1, v, 8, 5, 67), 6);
      }
    });
    it('paints valid RGB everywhere', () => {
      for (let i = 0; i <= 20; i++) {
        for (let j = 0; j <= 20; j++) {
          const px = deepFieldPixel(i / 20, j / 20);
          expect(px).toHaveLength(3);
          for (const ch of px) {
            expect(Number.isFinite(ch)).toBe(true);
            expect(ch).toBeGreaterThanOrEqual(0);
            expect(ch).toBeLessThanOrEqual(255);
          }
        }
      }
    });
    it('is brighter along the galactic band than at the poles, on average', () => {
      // Point samples are misleading: dust lanes carve the band's core, so individual
      // pixels there can be near-black. The band is brighter in aggregate.
      const mean = (v: number) => {
        let sum = 0;
        for (let i = 0; i < 60; i++) sum += deepFieldPixel(i / 60, v).reduce((a, b) => a + b, 0);
        return sum / 60;
      };
      expect(mean(0.5)).toBeGreaterThan(mean(0.03));
    });
    it('stays a deep sky — never washes out to white', () => {
      let max = 0;
      for (let i = 0; i <= 30; i++)
        for (let j = 0; j <= 30; j++)
          max = Math.max(max, ...deepFieldPixel(i / 30, j / 30));
      expect(max).toBeLessThan(120); // dim enough that stars still read against it
    });
  });

  describe('ignite / magnitude', () => {
    it('ignite runs 0 → 1 and clamps at both ends', () => {
      expect(ignite(1, 0, 0.6)).toBe(0);
      expect(ignite(1, 1, 0.6)).toBe(0);
      expect(ignite(1, 1.3, 0.6)).toBeCloseTo(0.5, 1);
      expect(ignite(1, 5, 0.6)).toBe(1);
    });
    it('magnitude spreads the mid-range and stays within 0..1', () => {
      expect(magnitude(0, 7)).toBe(0);
      expect(magnitude(7, 7)).toBe(1);
      expect(magnitude(3, 7)).toBeGreaterThan(3 / 7); // perceptual curve lifts the middle
    });
    it('magnitude tolerates a zero-degree graph', () => {
      expect(magnitude(0, 0)).toBe(0);
    });
  });
});
