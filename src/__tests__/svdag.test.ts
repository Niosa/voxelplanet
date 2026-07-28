import { describe, it, expect, beforeEach } from 'vitest';
import {
  SVDAGChunk,
  CHUNK_SIZE,
} from '../voxel/SVDAGChunk';
import {
  ChunkManager,
  chunkKey,
  parseChunkKey,
} from '../voxel/ChunkManager';
import {
  EMPTY_NODE,
  makeLeaf,
  makeInternal,
  canonicalize,
  resetInternPool,
  isLeaf,
  internPoolSize,
} from '../voxel/SVDAGNode';
import { traverseSVDAG } from '../voxel/LODTraversal';
import { Vector3 } from '@babylonjs/core';

// ── Round-trip set/get ───────────────────────────────────────────────────
describe('SVDAGChunk.get/set', () => {
  beforeEach(() => resetInternPool());

  it('returns 0 (air) for an empty chunk', () => {
    const c = new SVDAGChunk(0, 0, 0);
    expect(c.isEmpty()).toBe(true);
    expect(c.get(0, 0, 0)).toBe(0);
    expect(c.get(15, 15, 15)).toBe(0);
  });

  it('round-trips a single voxel', () => {
    const c = new SVDAGChunk(0, 0, 0);
    c.set(5, 5, 5, 7);
    expect(c.get(5, 5, 5)).toBe(7);
    expect(c.get(0, 0, 0)).toBe(0);
    expect(c.isEmpty()).toBe(false);
  });

  it('round-trips at all 8 corners', () => {
    const c = new SVDAGChunk(1, 2, 3);
    const corners = [
      [0, 0, 0], [31, 0, 0], [0, 31, 0], [31, 31, 0],
      [0, 0, 31], [31, 0, 31], [0, 31, 31], [31, 31, 31],
    ] as const;
    for (let i = 0; i < corners.length; i++) {
      const [x, y, z] = corners[i]!;
      c.set(x, y, z, i + 1);
    }
    for (let i = 0; i < corners.length; i++) {
      const [x, y, z] = corners[i]!;
      expect(c.get(x, y, z)).toBe(i + 1);
    }
  });

  it('overwrites a voxel back to 0 (air) and collapses the DAG', () => {
    const c = new SVDAGChunk(0, 0, 0);
    c.set(10, 10, 10, 5);
    expect(c.get(10, 10, 10)).toBe(5);
    c.set(10, 10, 10, 0);
    expect(c.get(10, 10, 10)).toBe(0);
    expect(c.isEmpty()).toBe(true);
  });

  it('out-of-bounds reads return 0 (air)', () => {
    const c = new SVDAGChunk(0, 0, 0);
    c.set(0, 0, 0, 9);
    expect(c.get(-1, 0, 0)).toBe(0);
    expect(c.get(0, CHUNK_SIZE, 0)).toBe(0);
  });
});

// ── Canonicalization / deduplication ─────────────────────────────────────
describe('SVDAGNode.canonicalize', () => {
  beforeEach(() => resetInternPool());

  it('returns the EMPTY_NODE sentinel for empty trees', () => {
    expect(canonicalize(makeInternal([EMPTY_NODE, EMPTY_NODE, EMPTY_NODE, EMPTY_NODE,
      EMPTY_NODE, EMPTY_NODE, EMPTY_NODE, EMPTY_NODE]))).toBe(EMPTY_NODE);
  });

  it('deduplicates two structurally-identical subtrees', () => {
    const a = makeInternal([EMPTY_NODE, makeLeaf(3), EMPTY_NODE, EMPTY_NODE,
      EMPTY_NODE, EMPTY_NODE, EMPTY_NODE, EMPTY_NODE]);
    const b = makeInternal([EMPTY_NODE, makeLeaf(3), EMPTY_NODE, EMPTY_NODE,
      EMPTY_NODE, EMPTY_NODE, EMPTY_NODE, EMPTY_NODE]);
    const ca = canonicalize(a);
    const cb = canonicalize(b);
    expect(ca).toBe(cb);
  });

  it('keeps different subtrees distinct', () => {
    const a = makeInternal([EMPTY_NODE, makeLeaf(3), EMPTY_NODE, EMPTY_NODE,
      EMPTY_NODE, EMPTY_NODE, EMPTY_NODE, EMPTY_NODE]);
    const b = makeInternal([EMPTY_NODE, makeLeaf(4), EMPTY_NODE, EMPTY_NODE,
      EMPTY_NODE, EMPTY_NODE, EMPTY_NODE, EMPTY_NODE]);
    const ca = canonicalize(a);
    const cb = canonicalize(b);
    expect(ca).not.toBe(cb);
  });

  it('leaves carry their voxel type', () => {
    const n = makeLeaf(42);
    expect(isLeaf(n)).toBe(true);
    expect(n.voxelType).toBe(42);
    expect(canonicalize(n).voxelType).toBe(42);
  });

  it('internPoolSize grows with unique structures', () => {
    canonicalize(makeLeaf(1));
    canonicalize(makeLeaf(2));
    canonicalize(makeLeaf(3));
    expect(internPoolSize()).toBeGreaterThanOrEqual(3);
  });
});

// ── ChunkManager LRU ────────────────────────────────────────────────────
describe('ChunkManager', () => {
  beforeEach(() => resetInternPool());

  it('creates and retrieves chunks', () => {
    const m = new ChunkManager();
    const a = m.getOrCreate(1, 2, 3);
    const b = m.getOrCreate(1, 2, 3);
    expect(a).toBe(b);
    expect(m.size).toBe(1);
  });

  it('chunkKey is reversible', () => {
    expect(parseChunkKey(chunkKey(-5, 17, 999))).toEqual([-5, 17, 999]);
  });

  it('evictLRU removes the oldest chunk when over budget', () => {
    const m = new ChunkManager(64);
    const c = m.getOrCreate(0, 0, 0);
    c.set(0, 0, 0, 1);
    c.set(1, 0, 0, 2);
    c.set(2, 0, 0, 3);
    for (let i = 0; i < 5; i++) c.get(i, 0, 0);
    const d = m.getOrCreate(0, 0, 1);
    d.set(0, 0, 0, 1);
    const evicted = m.evictLRU();
    expect(evicted).toBeGreaterThan(0);
    expect(m.size).toBeLessThan(2);
  });

  it('applyDelta routes changes to the right chunk', () => {
    const m = new ChunkManager();
    m.applyDelta({
      chunkKey: '4,5,6',
      timestamp: 0,
      playerId: 'p',
      changes: [
        { localX: 1, localY: 2, localZ: 3, voxelType: 11 },
        { localX: 0, localY: 0, localZ: 0, voxelType: 0 },
      ],
    });
    const c = m.getByCoords(4, 5, 6)!;
    expect(c.get(1, 2, 3)).toBe(11);
    expect(c.get(0, 0, 0)).toBe(0);
  });
});

// ── LOD traversal ────────────────────────────────────────────────────────
describe('LODTraversal.traverseSVDAG', () => {
  beforeEach(() => resetInternPool());

  it('returns at least the root for an empty tree', () => {
    const out = traverseSVDAG(EMPTY_NODE, new Vector3(100, 100, 100), 0.01);
    expect(out.length).toBe(1);
    expect(out[0]!.node).toBe(EMPTY_NODE);
  });

  it('descends more deeply when the camera is close', () => {
    const root = makeInternal([
      makeLeaf(1), makeLeaf(2), makeLeaf(3), makeLeaf(4),
      makeLeaf(5), makeLeaf(6), makeLeaf(7), makeLeaf(8),
    ]);
    const canon = canonicalize(root);
    const far = traverseSVDAG(canon, new Vector3(1e6, 1e6, 1e6), 0.001, new Vector3(0, 0, 0), 32);
    const near = traverseSVDAG(canon, new Vector3(16, 16, 16), 0.001, new Vector3(0, 0, 0), 32);
    expect(near.length).toBeGreaterThanOrEqual(far.length);
  });
});
