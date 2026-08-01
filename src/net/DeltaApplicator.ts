/**
 * DeltaApplicator — receives incoming VoxelDeltas from the network layer
 * and applies them to both the local ChunkManager and the globe surface.
 *
 * This module sits at Step 10 of the plan (multiplayer delta sync).
 * It wires together:
 *   • ChunkManager.applyDelta()    — updates in-memory voxel data
 *   • applyDeltaToHeightmap()      — propagates edits to the globe mesh
 *   • A dirty-set + rAF batch      — defers DOM/WebGL work off the hot path
 */

import { applyDeltaToHeightmap } from '../globe/GlobePatcher.ts';
import type { ChunkManager, VoxelDeltaLike } from '../voxel/ChunkManager.ts';

export interface DeltaApplicatorOptions {
  chunkManager: ChunkManager;
  /**
   * Per-face heightmap arrays that back the globe surface.
   * Index 0-5, matching the CubeSphere face order.
   */
  faceHeightmaps: Float32Array[];
  /** Globe heightmap resolution (N × N per face). */
  heightmapResolution: number;
  /**
   * Called after one or more globe faces are patched so the renderer
   * can re-upload mesh data.  Receives the array of dirty face indices.
   */
  onFacesDirty?: (faceIndices: number[]) => void;
}

export class DeltaApplicator {
  private _chunkManager: ChunkManager;
  private _faceHeightmaps: Float32Array[];
  private _resolution: number;
  private _onFacesDirty: ((fi: number[]) => void) | undefined;

  private _dirtyFaces = new Set<number>();
  private _rafPending = false;

  constructor(opts: DeltaApplicatorOptions) {
    this._chunkManager   = opts.chunkManager;
    this._faceHeightmaps = opts.faceHeightmaps;
    this._resolution     = opts.heightmapResolution;
    this._onFacesDirty   = opts.onFacesDirty;
  }

  /**
   * Apply a single incoming delta.
   * Safe to call from a WebSocket `onmessage` handler.
   */
  applyDelta(delta: VoxelDeltaLike): void {
    // 1. Apply to voxel data
    this._chunkManager.applyDelta(delta);

    // 2. Determine which globe face this chunk belongs to and apply to heightmap.
    //    The faceIndex is embedded in the chunkKey by convention:
    //    ChunkStreamer generates keys as  "cx,cy,cz"  and annotates the chunk
    //    with a faceIndex in its metadata.  For now we derive faceIndex from
    //    the chunk coords using a heuristic (dominant axis of chunk centre).
    const faceIndex = _faceIndexFromChunkKey(delta.chunkKey);
    const heightmap = this._faceHeightmaps[faceIndex];
    if (heightmap) {
      applyDeltaToHeightmap(delta, heightmap, this._resolution);
      this._dirtyFaces.add(faceIndex);
      this._scheduleBatch();
    }
  }

  /**
   * Apply an array of deltas (e.g. initial state snapshot).
   */
  applyBatch(deltas: VoxelDeltaLike[]): void {
    for (const d of deltas) this.applyDelta(d);
  }

  private _scheduleBatch(): void {
    if (this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      const dirty = Array.from(this._dirtyFaces);
      this._dirtyFaces.clear();
      this._rafPending = false;
      if (dirty.length > 0) this._onFacesDirty?.(dirty);
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the closest cube face (0-5) for a chunk.
 * Uses the dominant axis of the chunk grid coords as a proxy for the
 * surface normal direction.
 *
 * Face index convention (matches CubeSphere.ts):
 *   0 = +Y (top)    1 = -Y (bottom)
 *   2 = +X (right)  3 = -X (left)
 *   4 = +Z (front)  5 = -Z (back)
 */
function _faceIndexFromChunkKey(key: string): number {
  const parts = key.split(',');
  const cx = Number(parts[0] ?? 0);
  const cy = Number(parts[1] ?? 0);
  const cz = Number(parts[2] ?? 0);
  const ax = Math.abs(cx), ay = Math.abs(cy), az = Math.abs(cz);
  if (ay >= ax && ay >= az) return cy >= 0 ? 0 : 1;
  if (ax >= ay && ax >= az) return cx >= 0 ? 2 : 3;
  return cz >= 0 ? 4 : 5;
}
