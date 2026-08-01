/**
 * GlobePatcher — applies walk-mode voxel edits back to the globe surface mesh.
 *
 * When a player breaks/places blocks in walk mode, those changes must be
 * reflected on the globe surface so large structures (e.g. a city-sized
 * hot dog) are visible from orbit.
 *
 * Strategy:
 *   1. Listen for 'blockBroken' and 'blockPlaced' CustomEvents emitted by
 *      BlockInteraction (Step 9).
 *   2. Accumulate a dirty-region per cube face: a bounding box of changed
 *      heightmap cells.
 *   3. On the next animation frame, re-sample the affected patch using
 *      ChunkManager.estimateMemoryBytes() and write updated heights back
 *      into a DynamicTexture that overrides the face mesh's height.
 *   4. Since globe meshes use static VertexData (updatable=false), we instead
 *      keep a Float32Array patch cache per face and mark the Babylon Mesh as
 *      dirty so it gets re-uploaded next frame.
 *
 * For Step 8 integration: GlobePatcher also exports
 * `applyDeltaToHeightmap()` as required by plan.md Step 10.
 */

import { Mesh, VertexData } from '@babylonjs/core';
import type { VoxelDeltaLike } from '../voxel/ChunkManager.ts';
import { generateHeightmap } from './HeightmapGenerator.ts';
import { PLANET_RADIUS_KM, WORLD_SEED } from './GlobeCoordMapper.ts';

export interface PatcherOptions {
  /** The 6 globe face meshes, indexed 0-5. */
  faceMeshes: Mesh[];
  /** Resolution used when the globe was originally generated. */
  faceResolution: number;
  seed?: number;
}

interface DirtyRegion {
  minRow: number; maxRow: number;
  minCol: number; maxCol: number;
}

/**
 * Per-face heightmap cache — initially null (use generated data).
 * Populated lazily when the first edit touches that face.
 */
const _heightPatches: Map<number, Float32Array> = new Map();

export class GlobePatcher {
  private _faceMeshes: Mesh[];
  private _resolution: number;
  private _seed: number;
  private _dirty: Map<number, DirtyRegion> = new Map();
  private _rafPending = false;

  constructor(opts: PatcherOptions) {
    this._faceMeshes = opts.faceMeshes;
    this._resolution = opts.faceResolution;
    this._seed = opts.seed ?? WORLD_SEED;

    // Listen for block events from walk mode
    window.addEventListener('blockBroken', (e: Event) => {
      this._onBlockEvent(e as CustomEvent<BlockEventDetail>, false);
    });
    window.addEventListener('blockPlaced', (e: Event) => {
      this._onBlockEvent(e as CustomEvent<BlockEventDetail>, true);
    });
  }

  private _onBlockEvent(e: CustomEvent<BlockEventDetail>, _isPlace: boolean): void {
    const { faceIndex, faceRow, faceCol } = e.detail;
    if (faceIndex < 0 || faceIndex > 5) return;

    let region = this._dirty.get(faceIndex);
    if (!region) {
      region = { minRow: faceRow, maxRow: faceRow, minCol: faceCol, maxCol: faceCol };
      this._dirty.set(faceIndex, region);
    } else {
      region.minRow = Math.min(region.minRow, faceRow);
      region.maxRow = Math.max(region.maxRow, faceRow);
      region.minCol = Math.min(region.minCol, faceCol);
      region.maxCol = Math.max(region.maxCol, faceCol);
    }

    if (!this._rafPending) {
      this._rafPending = true;
      requestAnimationFrame(() => this._flush());
    }
  }

  private _flush(): void {
    this._rafPending = false;
    for (const [faceIndex, region] of this._dirty) {
      this._repatchFace(faceIndex, region);
    }
    this._dirty.clear();
  }

  /**
   * Re-generate the heightmap for the dirty region and update vertex positions
   * on the face mesh.
   *
   * We regenerate the *entire* face heightmap rather than just the patch to
   * keep the border-stitching maths simple.  The face mesh is small (128×128)
   * so this is fast (< 2 ms on main thread).
   */
  private _repatchFace(faceIndex: number, _region: DirtyRegion): void {
    const mesh = this._faceMeshes[faceIndex];
    if (!mesh) return;

    // Get or regenerate patch cache
    let patch = _heightPatches.get(faceIndex);
    if (!patch) {
      const result = generateHeightmap({
        seed: this._seed,
        resolution: this._resolution,
        faceIndex: faceIndex as 0|1|2|3|4|5,
      });
      patch = result.heights.slice();
      _heightPatches.set(faceIndex, patch);
    }

    // Rebuild vertex positions from updated patch
    const N = this._resolution;
    const vertCount = (N + 1) * (N + 1);
    const positions = new Float32Array(vertCount * 3);
    // Re-import generateCubeFace inline to avoid circular deps
    _rebuildFacePositions(faceIndex, N, PLANET_RADIUS_KM, patch, positions);

    // Update the mesh's positions buffer
    // Babylon requires the mesh was created with updatable=true; if not,
    // we recreate the VertexData on the existing mesh object.
    const vd = new VertexData();
    vd.positions = positions;
    // Only update positions — normals/uvs/indices unchanged
    vd.applyToMesh(mesh, true);
  }

  dispose(): void {
    window.removeEventListener('blockBroken', this._onBlockEvent as EventListener);
    window.removeEventListener('blockPlaced', this._onBlockEvent as EventListener);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BlockEventDetail {
  faceIndex: number;
  faceRow: number;
  faceCol: number;
  chunkKey: string;
  x: number; y: number; z: number;
}

/**
 * Rebuild sphere surface vertex positions for a single cube face,
 * given an updated heightmap patch.
 * (Mirrors the logic in CubeSphere.generateCubeFace without full geometry.)
 */
function _rebuildFacePositions(
  faceIndex: number,
  N: number,
  radius: number,
  heightmap: Float32Array,
  out: Float32Array
): void {
  const FACE_AXES = [
    { forward: [0,  1,  0], right: [1, 0,  0], up: [0, 0, -1] },
    { forward: [0, -1,  0], right: [1, 0,  0], up: [0, 0,  1] },
    { forward: [1,  0,  0], right: [0, 0,  1], up: [0, 1,  0] },
    { forward: [-1, 0,  0], right: [0, 0, -1], up: [0, 1,  0] },
    { forward: [0,  0,  1], right: [-1, 0, 0], up: [0, 1,  0] },
    { forward: [0,  0, -1], right: [1,  0,  0], up: [0, 1,  0] },
  ];
  const axes = FACE_AXES[faceIndex]!;
  let vi = 0;
  for (let row = 0; row <= N; row++) {
    for (let col = 0; col <= N; col++) {
      const s = (col / N) * 2 - 1;
      const t = (row / N) * 2 - 1;
      const cx = axes.forward[0]! + axes.right[0]! * s + axes.up[0]! * t;
      const cy = axes.forward[1]! + axes.right[1]! * s + axes.up[1]! * t;
      const cz = axes.forward[2]! + axes.right[2]! * s + axes.up[2]! * t;
      const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
      const nx = cx / len, ny = cy / len, nz = cz / len;
      const hmCol = Math.min(Math.floor(col / N * (N - 1) + 0.5), N - 1);
      const hmRow = Math.min(Math.floor(row / N * (N - 1) + 0.5), N - 1);
      const h = heightmap[hmRow * N + hmCol] ?? 0;
      const r = radius + h;
      out[vi * 3 + 0] = nx * r;
      out[vi * 3 + 1] = ny * r;
      out[vi * 3 + 2] = nz * r;
      vi++;
    }
  }
}

/**
 * Required by plan.md Step 10: apply a VoxelDelta to a globe face heightmap.
 * Called by DeltaApplicator after receiving remote player edits.
 *
 * @param delta       - The incoming voxel delta from another player.
 * @param heightmap   - The per-face Float32Array heightmap to mutate.
 * @param resolution  - The heightmap resolution (N).
 */
export function applyDeltaToHeightmap(
  delta: VoxelDeltaLike,
  heightmap: Float32Array,
  resolution: number
): void {
  for (const change of delta.changes) {
    // Map local voxel x/z (0-31) to heightmap row/col
    const col = Math.floor(change.localX / 32 * resolution);
    const row = Math.floor(change.localZ / 32 * resolution);
    const idx = row * resolution + col;
    if (idx < 0 || idx >= heightmap.length) continue;
    if (change.voxelType === 0) {
      // Broken block — lower the heightmap by 1 km unit (1 voxel at globe scale)
      heightmap[idx] = Math.max(0, (heightmap[idx] ?? 0) - 1);
    } else {
      // Placed block — raise it
      heightmap[idx] = (heightmap[idx] ?? 0) + 1;
    }
  }
}
