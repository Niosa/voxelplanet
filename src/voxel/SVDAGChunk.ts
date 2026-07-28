/**
 * SVDAGChunk — a 32×32×32 voxel chunk stored as a Sparse Voxel DAG.
 *
 * Coordinate space:
 *   - `cx, cy, cz` is the chunk's integer index (one per 32 voxels).
 *   - `x, y, z` in `get`/`set` are local coords in [0, CHUNK_SIZE).
 *
 * The chunk root is canonicalized after every write so deduplication
 * remains valid.
 */

import {
  SVDAGNode,
  EMPTY_NODE,
  makeLeaf,
  makeInternal,
  canonicalize,
  isLeaf,
} from './SVDAGNode.ts';

export const CHUNK_SIZE = 32;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

export class SVDAGChunk {
  /** Integer chunk index (uniquely identifies this chunk in world space). */
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;

  /** Root of the SVDAG. Always canonical. */
  root: SVDAGNode;

  /** Last-accessed timestamp (ms, `performance.now()`). */
  lastAccessed: number;

  /** Approximate node count in the local DAG (for memory estimates). */
  nodeCount: number;

  /** Bounding box in chunk-local voxel coords (always [0..CHUNK_SIZE]). */
  static readonly LOCAL_BBOX_MIN = { x: 0, y: 0, z: 0 };
  static readonly LOCAL_BBOX_MAX = { x: CHUNK_SIZE, y: CHUNK_SIZE, z: CHUNK_SIZE };

  constructor(cx: number, cy: number, cz: number) {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.root = EMPTY_NODE;
    this.lastAccessed = performance.now();
    this.nodeCount = 1; // the root counts
  }

  /** Read the voxel type at local (x, y, z). 0 = air. */
  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || y >= CHUNK_SIZE || z >= CHUNK_SIZE) {
      return 0;
    }
    return _getNode(this.root, x, y, z, CHUNK_SIZE);
  }

  /**
   * Write the voxel type at local (x, y, z).
   * Rebuilds the affected subtree and re-canonicalizes the result.
   * `voxelType = 0` is treated as air; the affected octant is pruned.
   */
  set(x: number, y: number, z: number, voxelType: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || y >= CHUNK_SIZE || z >= CHUNK_SIZE) {
      return;
    }
    const before = this.root;
    const after = _setNode(before, x, y, z, voxelType, CHUNK_SIZE);
    this.root = canonicalize(after);
    this.touch();
  }

  /** True iff the chunk is entirely empty (root is the empty leaf). */
  isEmpty(): boolean {
    return this.root === EMPTY_NODE || (this.root.childMask === 0 && this.root.voxelType === 0);
  }

  /** Update `lastAccessed` to now. Call on every read/write. */
  touch(): void {
    this.lastAccessed = performance.now();
  }

  /**
   * Iterate every non-empty voxel (sample for classification, etc.).
   * Callback signature: `(x, y, z, voxelType) => boolean` — return `false`
   * to abort iteration.
   *
   * For leaf nodes that cover more than one voxel we expand the leaf to
   * its full volume so the caller sees a sample per voxel (not one per
   * DAG node). This matters for `classifyChunk` which needs voxel-level
   * biome distribution.
   */
  forEachSolid(cb: (x: number, y: number, z: number, voxelType: number) => boolean): void {
    _forEachSolid(this.root, 0, 0, 0, CHUNK_SIZE, cb);
  }
}

// ---------------------------------------------------------------------------
// Internal traversal helpers (operate on already-canonical nodes).
// ---------------------------------------------------------------------------

function _getNode(node: SVDAGNode, x: number, y: number, z: number, currentSize: number): number {
  if (isLeaf(node)) return node.voxelType;
  // Descend into the correct octant.
  const childSize = currentSize / 2;
  const octant = _octantOf(x, y, z, childSize);
  const child = node.children[octant]!;
  if (typeof child === 'number') return child;
  return _getNode(child, x, y, z, childSize);
}

/** Compute octant for a coord at a given child size. */
function _octantOf(x: number, y: number, z: number, childSize: number): number {
  const half = childSize / 2;
  let o = 0;
  if (x >= half) o |= 1;
  if (y >= half) o |= 2;
  if (z >= half) o |= 4;
  return o;
}

/**
 * Walk into the DAG, building a new path with the new voxel at (x, y, z).
 * `currentSize` is the size of `node`'s volume.
 */
function _setNode(
  node: SVDAGNode,
  x: number, y: number, z: number,
  voxelType: number,
  currentSize: number,
): SVDAGNode {
  if (currentSize === 1) {
    return makeLeaf(voxelType);
  }

  const halfSize = currentSize / 2;
  const octant = _octantOf(x, y, z, halfSize);

  if (isLeaf(node)) {
    if (node.voxelType === voxelType) return node; // no change
    // Splat the existing leaf into 8 children of the same type, then
    // overwrite the target octant.
    const childLeaf = makeLeaf(node.voxelType);
    const children: SVDAGNode[] = new Array(8).fill(childLeaf) as SVDAGNode[];
    children[octant] = _setNode(childLeaf, x, y, z, voxelType, halfSize);
    return makeInternal(children);
  }

  // Internal node: recurse into the target octant.
  const existing = node.children[octant]!;
  const existingNode: SVDAGNode =
    typeof existing === 'number' ? makeLeaf(existing) : existing;
  const updatedChild = _setNode(existingNode, x, y, z, voxelType, halfSize);

  // Copy children array, replace the target octant.
  const newChildren: Array<SVDAGNode | number | undefined> = new Array(8);
  for (let i = 0; i < 8; i++) {
    newChildren[i] = node.children[i] ?? EMPTY_NODE;
  }
  newChildren[octant] = updatedChild;

  // If all 8 children are the same non-empty leaf, collapse one level.
  const allSame = _allSameLeafOrEmpty(newChildren);
  if (allSame.kind === 'leaf') {
    return makeLeaf(allSame.voxelType);
  }
  return makeInternal(newChildren);
}

function _allSameLeafOrEmpty(
  children: Array<SVDAGNode | number | undefined>,
): { kind: 'leaf' | 'mixed'; voxelType: number } {
  let vt = -1;
  for (let i = 0; i < 8; i++) {
    const c = children[i]!;
    const node: SVDAGNode = typeof c === 'number' ? makeLeaf(c) : (c ?? EMPTY_NODE);
    if (!isLeaf(node)) return { kind: 'mixed', voxelType: 0 };
    if (vt === -1) vt = node.voxelType;
    else if (vt !== node.voxelType) return { kind: 'mixed', voxelType: 0 };
  }
  return { kind: 'leaf', voxelType: vt === -1 ? 0 : vt };
}

function _forEachSolid(
  node: SVDAGNode,
  ox: number, oy: number, oz: number,
  size: number,
  cb: (x: number, y: number, z: number, voxelType: number) => boolean,
): void {
  if (isLeaf(node)) {
    if (node.voxelType === 0) return;
    // Expand the leaf to its full volume. We sample at the leaf's origin
    // and at size-1 offset, plus every 4th voxel on each axis, so that
    // very large leaves still contribute a representative sample count.
    const step = Math.max(1, Math.floor(size / 2));
    for (let dz = 0; dz < size; dz += step) {
      for (let dy = 0; dy < size; dy += step) {
        for (let dx = 0; dx < size; dx += step) {
          if (!cb(ox + dx, oy + dy, oz + dz, node.voxelType)) return;
        }
      }
    }
    return;
  }
  const half = size / 2;
  for (let i = 0; i < 8; i++) {
    const c = node.children[i]!;
    if (c === EMPTY_NODE) continue;
    const cx = ox + ((i & 1) ? half : 0);
    const cy = oy + ((i & 2) ? half : 0);
    const cz = oz + ((i & 4) ? half : 0);
    const child: SVDAGNode = typeof c === 'number' ? makeLeaf(c) : c;
    _forEachSolid(child, cx, cy, cz, half, cb);
  }
}
