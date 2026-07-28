/**
 * ChunkManager — registry of `SVDAGChunk` instances with LRU eviction
 * constrained by a VRAM budget.
 *
 * Worker-safe: this file imports only pure JS modules (no DOM, no Babylon).
 */

import { SVDAGChunk } from './SVDAGChunk.ts';
import { internPoolSize } from './SVDAGNode.ts';

/** A delta of voxel changes to apply to a chunk. Defined in Step 10. */
export interface VoxelDeltaLike {
  chunkKey: string;
  changes: Array<{
    localX: number;
    localY: number;
    localZ: number;
    voxelType: number;
  }>;
  timestamp: number;
  playerId: string;
}

/** Approximate bytes per DAG node (children array + mask + hash). */
const BYTES_PER_NODE_ESTIMATE = 96;

export const DEFAULT_VRAM_BUDGET_BYTES = 256 * 1024 * 1024; // 256 MB
const EVICT_TARGET_RATIO = 0.8; // evict until we're below 80% of budget

export class ChunkManager {
  private _chunks = new Map<string, SVDAGChunk>();
  private _vramBudgetBytes: number;

  constructor(vramBudgetBytes: number = DEFAULT_VRAM_BUDGET_BYTES) {
    this._vramBudgetBytes = vramBudgetBytes;
  }

  /** Get an existing chunk or create an empty one. */
  getOrCreate(cx: number, cy: number, cz: number): SVDAGChunk {
    const key = chunkKey(cx, cy, cz);
    let chunk = this._chunks.get(key);
    if (!chunk) {
      chunk = new SVDAGChunk(cx, cy, cz);
      this._chunks.set(key, chunk);
    } else {
      chunk.touch();
    }
    return chunk;
  }

  /** Look up a chunk by its key without creating. */
  get(key: string): SVDAGChunk | undefined {
    const c = this._chunks.get(key);
    if (c) c.touch();
    return c;
  }

  /** Look up a chunk by integer coords without creating. */
  getByCoords(cx: number, cy: number, cz: number): SVDAGChunk | undefined {
    return this.get(chunkKey(cx, cy, cz));
  }

  /** Remove a chunk by key. */
  delete(key: string): boolean {
    return this._chunks.delete(key);
  }

  /** Number of live chunks. */
  get size(): number {
    return this._chunks.size;
  }

  /** Iterate all chunks (LRU-oldest first). */
  *chunksByLRU(): IterableIterator<SVDAGChunk> {
    const arr = Array.from(this._chunks.values());
    arr.sort((a, b) => a.lastAccessed - b.lastAccessed);
    yield* arr;
  }

  /**
   * Estimate current memory usage in bytes.
   * Uses each chunk's `nodeCount` and the global intern pool size.
   */
  estimateMemoryBytes(): number {
    let localNodes = 0;
    for (const c of this._chunks.values()) localNodes += c.nodeCount;
    // Combine with globally-interned nodes (the chunk nodes *are* interned,
    // so this would double-count; use the larger of the two).
    const globalNodes = internPoolSize();
    const nodes = Math.max(localNodes, globalNodes);
    return nodes * BYTES_PER_NODE_ESTIMATE;
  }

  /**
   * Evict least-recently-used chunks until the estimated memory usage
   * drops below `_vramBudgetBytes * EVICT_TARGET_RATIO`, or the cache is empty.
   * Returns the number of chunks evicted.
   */
  evictLRU(): number {
    let evicted = 0;
    const target = this._vramBudgetBytes * EVICT_TARGET_RATIO;
    for (const chunk of this.chunksByLRU()) {
      if (this.estimateMemoryBytes() <= target) break;
      const key = chunkKey(chunk.cx, chunk.cy, chunk.cz);
      this._chunks.delete(key);
      evicted++;
    }
    return evicted;
  }

  /**
   * Apply a delta of voxel changes. The delta type is defined fully in
   * Step 10 (`src/net/VoxelDelta.ts`); we use a structural type here to
   * avoid an import cycle.
   */
  applyDelta(delta: VoxelDeltaLike): void {
    const [cx, cy, cz] = parseChunkKey(delta.chunkKey);
    const chunk = this.getOrCreate(cx, cy, cz);
    for (const change of delta.changes) {
      chunk.set(change.localX, change.localY, change.localZ, change.voxelType);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode chunk coords to a stable string key. */
export function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

/** Parse a chunk key back to integer coords. */
export function parseChunkKey(key: string): [number, number, number] {
  const parts = key.split(',');
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}
