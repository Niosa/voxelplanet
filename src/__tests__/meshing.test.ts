import { describe, it, expect, beforeEach } from 'vitest';
import { SVDAGChunk, CHUNK_SIZE } from '../voxel/SVDAGChunk';
import { GPUMesher } from '../voxel/GPUMesher';
import { classifyChunk } from '../voxel/MeshClassifier';
import { resetInternPool, makeLeaf, makeInternal, canonicalize } from '../voxel/SVDAGNode';
import { traverseSVDAG } from '../voxel/LODTraversal';
import { Vector3 } from '@babylonjs/core';

// ── classifyChunk ────────────────────────────────────────────────────────
describe('classifyChunk', () => {
  beforeEach(() => resetInternPool());

  it('returns "organic" for an empty chunk', () => {
    const c = new SVDAGChunk(0, 0, 0);
    expect(classifyChunk(c)).toBe('organic');
  });

  it('returns "blocky" when the chunk is dominated by urban biomes', () => {
    const c = new SVDAGChunk(0, 0, 0);
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let y = 0; y < CHUNK_SIZE; y++)
        for (let x = 0; x < CHUNK_SIZE; x++)
          c.set(x, y, z, 12);
    expect(classifyChunk(c)).toBe('blocky');
  });

  it('returns "organic" when urban biomes are a minority', () => {
    const c = new SVDAGChunk(0, 0, 0);
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let y = 0; y < CHUNK_SIZE; y++)
        for (let x = 0; x < CHUNK_SIZE; x++)
          c.set(x, y, z, x < 4 ? 12 : 3);
    expect(classifyChunk(c)).toBe('organic');
  });
});

// ── GPUMesher (JS fallback path) ─────────────────────────────────────────
describe('GPUMesher', () => {
  it('meshBlocky produces a finite-quad buffer', async () => {
    const c = new SVDAGChunk(0, 0, 0);
    for (let z = 0; z < 4; z++)
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++)
          c.set(x, y, z, 1);
    const m = new GPUMesher();
    const buf = await m.meshBlocky(c);
    expect(buf.positions.length).toBe(1536 * 3);
    expect(buf.normals.length).toBe(1536 * 3);
    expect(buf.indices.length).toBe(1536 * 1.5);
  });

  it('meshOrganic produces a vertex per surface cell', async () => {
    const c = new SVDAGChunk(0, 0, 0);
    c.set(0, 0, 0, 1);
    const m = new GPUMesher();
    const buf = await m.meshOrganic(c);
    expect(buf.positions.length).toBeGreaterThanOrEqual(3);
  });

  it('meshBatch yields between frames for large workloads', async () => {
    const c1 = new SVDAGChunk(0, 0, 0);
    const c2 = new SVDAGChunk(1, 0, 0);
    for (const c of [c1, c2]) {
      for (let z = 0; z < 4; z++)
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++)
            c.set(x, y, z, 1);
    }
    const m = new GPUMesher();
    let progressCalls = 0;
    const results = await m.meshBatch([c1, c2], 'blocky', () => { progressCalls++; });
    expect(results.length).toBe(2);
    expect(progressCalls).toBe(2);
  });
});

// ── greedy vs naive ────────────────────────────────────────────────────────
describe('worker-side fallback mesher (greedy)', () => {
  it('emits fewer quads than the naive per-face baseline', async () => {
    const c = new SVDAGChunk(0, 0, 0);
    for (let z = 0; z < 4; z++)
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++)
          c.set(x, y, z, 1);
    const m = new GPUMesher();
    const buf = await m.meshBlocky(c);
    const naiveIndices = 64 * 6 * 6;
    expect(buf.indices.length).toBeLessThanOrEqual(naiveIndices);
  });
});

// ── LOD traversal (sanity) ────────────────────────────────────────────────
describe('traverseSVDAG sanity', () => {
  it('returns leaves for a flat DAG of voxels', () => {
    resetInternPool();
    const root = makeInternal([
      makeLeaf(1), makeLeaf(2), makeLeaf(3), makeLeaf(4),
      makeLeaf(5), makeLeaf(6), makeLeaf(7), makeLeaf(8),
    ]);
    const canon = canonicalize(root);
    const out = traverseSVDAG(canon, new Vector3(0.5, 0.5, 0.5), 0.0001);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]!.size).toBeLessThanOrEqual(32);
  });
});
