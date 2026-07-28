/**
 * SVDAGNode — Sparse Voxel Directed Acyclic Graph node.
 *
 * An octree node encoded as a single 8-bit child mask plus either:
 *   - child references (internal node), or
 *   - a material/voxel type id (leaf node).
 *
 * The DAG structure allows structurally-identical subtrees to be
 * deduplicated via `canonicalize()`. The intern pool is process-wide.
 */

/** Octant index 0..7, where bit `i` of `childMask` indicates presence. */
export type OctantIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Bit mask constants for the 8 octants (matches Babylon's left-handed XYZ). */
export const OCTANT_BIT: ReadonlyArray<number> = [
  1 << 0, 1 << 1, 1 << 2, 1 << 3,
  1 << 4, 1 << 5, 1 << 6, 1 << 7,
] as const;

export interface SVDAGNode {
  /** 8-bit mask — bit `i` set ⇔ `children[i]` is present. */
  childMask: number;
  /**
   * Children array. For internal nodes: 8 entries (one per octant), where
   *   absent octants hold the `EMPTY_NODE` sentinel.
   * For leaf nodes: a single-element array containing the `voxelType`.
   */
  children: Array<SVDAGNode | number | undefined>;
  /** Material/voxel id when this is a leaf. For internal nodes = 0. */
  voxelType: number;
  /** Pre-computed structural hash (populated by `canonicalize`). */
  hash?: number;
}

/** Canonical "empty" node — all octants absent, voxelType = 0 (air). */
export const EMPTY_NODE: SVDAGNode = Object.freeze({
  childMask: 0,
  children: [0],
  voxelType: 0,
  hash: 0,
}) as SVDAGNode;

/** True if this node represents "no voxel" — the empty leaf. */
export function isEmpty(node: SVDAGNode): boolean {
  return node === EMPTY_NODE || (node.childMask === 0 && node.voxelType === 0);
}

/** True if this node is a leaf (no children, has a material). */
export function isLeaf(node: SVDAGNode): boolean {
  return node.childMask === 0;
}

/** Create a leaf node holding a voxel type (0 = air, otherwise material id). */
export function makeLeaf(voxelType: number): SVDAGNode {
  if (voxelType === 0) return EMPTY_NODE;
  return { childMask: 0, children: [voxelType], voxelType };
}

/** Create an internal node from up to 8 child references. */
export function makeInternal(children: Array<SVDAGNode | number | undefined>): SVDAGNode {
  let mask = 0;
  const out: Array<SVDAGNode | number | undefined> = new Array(8);
  for (let i = 0; i < 8; i++) {
    const c = children[i];
    // Treat EMPTY_NODE (or anything leaf-zero) as "absent" — collapse.
    if (c === undefined || c === null || c === EMPTY_NODE) {
      out[i] = EMPTY_NODE;
      continue;
    }
    // Collapse a leaf(0) to EMPTY_NODE.
    if (typeof c !== 'number' && isLeaf(c) && c.voxelType === 0) {
      out[i] = EMPTY_NODE;
      continue;
    }
    mask |= OCTANT_BIT[i]!;
    out[i] = c;
  }
  // If all 8 children are empty, collapse to the empty leaf.
  if (mask === 0) return EMPTY_NODE;
  return { childMask: mask, children: out, voxelType: 0 };
}

// ---------------------------------------------------------------------------
// Structural hashing & deduplication (DAG intern pool)
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash (fast, good enough for intern keys). */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Process-wide intern pool keyed by structural hash. */
const INTERN_POOL = new Map<number, SVDAGNode>();

/**
 * Recursively hashes a node's subtree and returns a shared (deduplicated)
 * reference. Two structurally-identical subtrees will return the same
 * `SVDAGNode` instance after this pass.
 *
 * The pool is keyed by the structural hash. Collisions are resolved by
 * structural equality of child references.
 */
export function canonicalize(node: SVDAGNode): SVDAGNode {
  if (node === EMPTY_NODE) return EMPTY_NODE;

  // Recursively canonicalize children first.
  if (!isLeaf(node)) {
    for (let i = 0; i < 8; i++) {
      if (node.childMask & OCTANT_BIT[i]!) {
        const child = node.children[i]!;
        if (typeof child === 'number') {
          continue;
        }
        const canon = canonicalize(child);
        if (canon !== child) node.children[i] = canon;
      } else {
        node.children[i] = EMPTY_NODE;
      }
    }
  }

  // Compute structural hash.
  let key: string;
  if (isLeaf(node)) {
    key = `L:${node.voxelType}`;
  } else {
    let s = `I:${node.childMask.toString(16)}|`;
    for (let i = 0; i < 8; i++) {
      if (node.childMask & OCTANT_BIT[i]!) {
        const c = node.children[i]!;
        if (typeof c === 'number') {
          s += `n${c},`;
        } else {
          s += `${(c.hash ?? 0).toString(16)},`;
        }
      }
    }
    key = s;
  }
  const hash = fnv1a(key);
  node.hash = hash;

  // Try to share with an existing equivalent node.
  const existing = INTERN_POOL.get(hash);
  if (existing && _structuralEq(existing, node)) {
    return existing;
  }
  INTERN_POOL.set(hash, node);
  return node;
}

/** Identity-aware structural equality (assumes children already canonical). */
function _structuralEq(a: SVDAGNode, b: SVDAGNode): boolean {
  if (a === b) return true;
  if (a.childMask !== b.childMask) return false;
  if (a.voxelType !== b.voxelType) return false;
  if (a.childMask === 0) return true; // both leaves
  for (let i = 0; i < 8; i++) {
    if (a.childMask & OCTANT_BIT[i]!) {
      if (a.children[i] !== b.children[i]) return false;
    }
  }
  return true;
}

/** Clear the intern pool. Intended for tests; not used in production. */
export function resetInternPool(): void {
  INTERN_POOL.clear();
}

/** Approximate count of unique nodes currently in the intern pool. */
export function internPoolSize(): number {
  return INTERN_POOL.size;
}
