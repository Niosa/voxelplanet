/**
 * LODTraversal — screen-space-error-driven walk of an SVDAG.
 *
 * Returns a flat list of leaf nodes whose error is below the supplied
 * threshold, plus enough context (origin, size) to mesh each one.
 *
 * The traversal is pure (no GPU), so it is safe to call from workers.
 */

import { SVDAGNode, isLeaf } from './SVDAGNode.ts';
import { Vector3 } from '@babylonjs/core';

/** World-unit node sizes per LOD bucket (largest first). */
export const LOD_LEVELS: ReadonlyArray<number> = [512, 256, 128, 64, 32];

/** A node selected for meshing, with its world-space bounding box. */
export interface LODLeaf {
  node: SVDAGNode;
  /** World-space min corner of the node. */
  origin: Vector3;
  /** Edge length of the node volume in world units. */
  size: number;
  /** Material id (for leaf nodes) or 0. */
  voxelType: number;
}

/**
 * Walk the DAG depth-first. At each node, compute a screen-space error
 * metric `error = nodeSize / distance(nodeCenter, camera)`. If the error
 * is below `errorThreshold` we stop descending and treat the node as a
 * leaf for meshing purposes.
 *
 * @param root        The DAG root.
 * @param camera      Camera world position.
 * @param errorThreshold  Lower = higher quality. 0.001 ≈ pixels-per-radian
 *                        1/1000 — typical 1080p cull threshold.
 * @param origin      World-space origin of the root volume (default 0,0,0).
 * @param size        Edge length of the root volume in world units
 *                    (default 32 — chunk size in voxels × 1m).
 */
export function traverseSVDAG(
  root: SVDAGNode,
  camera: Vector3,
  errorThreshold: number,
  origin: Vector3 = new Vector3(0, 0, 0),
  size: number = 32,
): LODLeaf[] {
  const out: LODLeaf[] = [];
  _walk(root, origin, size, camera, errorThreshold, out);
  return out;
}

function _walk(
  node: SVDAGNode,
  origin: Vector3,
  size: number,
  camera: Vector3,
  threshold: number,
  out: LODLeaf[],
): void {
  const cx = origin.x + size * 0.5;
  const cy = origin.y + size * 0.5;
  const cz = origin.z + size * 0.5;
  const dx = cx - camera.x;
  const dy = cy - camera.y;
  const dz = cz - camera.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const error = dist > 1e-6 ? size / dist : Infinity;

  if (error < threshold || isLeaf(node)) {
    out.push({
      node,
      origin: origin.clone(),
      size,
      voxelType: node.voxelType,
    });
    return;
  }

  // Descend.
  const half = size / 2;
  for (let i = 0; i < 8; i++) {
    if (!(node.childMask & (1 << i))) continue;
    const child = node.children[i];
    if (child === undefined) continue;
    const ox = origin.x + ((i & 1) ? half : 0);
    const oy = origin.y + ((i & 2) ? half : 0);
    const oz = origin.z + ((i & 4) ? half : 0);
    const childNode: SVDAGNode =
      typeof child === 'number' ? { childMask: 0, children: [child], voxelType: child } : child;
    _walk(childNode, new Vector3(ox, oy, oz), half, camera, threshold, out);
  }
}
