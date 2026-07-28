/**
 * GreedyMesher — pure CPU binary greedy meshing, no DOM/Babylon.
 *
 * Worker-safe: this file imports nothing outside `src/voxel/`.
 */

import { CHUNK_VOLUME } from './SVDAGChunk.ts';

export interface MeshBuffers {
  positions: Float32Array;
  normals:   Float32Array;
  indices:   Uint32Array;
}

interface EmittedQuad {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  nx: number; ny: number; nz: number;
  materialId: number;
}

function _matAt(mat: Uint8Array, size: number, axis: number, slice: number, u: number, v: number): number {
  if (axis === 0) return mat[slice * size * size + u * size + v]!;
  if (axis === 1) return mat[u * size * size + slice * size + v]!;
  return mat[u * size * size + v * size + slice]!;
}

/**
 * Binary greedy meshing on a 3D voxel grid.
 *
 * @param solid  1D packed `Uint8Array` of length size³; non-zero = solid.
 * @param mat    1D packed `Uint8Array` of length size³; material id per voxel.
 * @param size   Cube edge length.
 */
export function greedyMesh(
  solid: Uint8Array,
  mat:   Uint8Array,
  size:  number,
): MeshBuffers {
  if (solid.length !== CHUNK_VOLUME && solid.length !== size * size * size) {
    // Allow general N³ volumes.
  }
  const quads: EmittedQuad[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (let slice = 0; slice < size; slice++) {
      for (let dir = -1; dir <= 1; dir += 2) {
        const neighbour = slice + dir;
        if (neighbour < 0 || neighbour >= size) continue;
        const frontIsSolid = (u: number, v: number) =>
          axis === 0 ? (solid[slice * size * size + u * size + v] !== 0)
        : axis === 1 ? (solid[u * size * size + slice * size + v] !== 0)
                     : (solid[u * size * size + v * size + slice] !== 0);
        const backIsSolid = (u: number, v: number) =>
          axis === 0 ? (solid[neighbour * size * size + u * size + v] !== 0)
        : axis === 1 ? (solid[u * size * size + neighbour * size + v] !== 0)
                     : (solid[u * size * size + v * size + neighbour] !== 0);
        const emitted = new Uint8Array(size * size);
        for (let v = 0; v < size; v++) {
          let u = 0;
          while (u < size) {
            if (emitted[v * size + u] || !frontIsSolid(u, v) || backIsSolid(u, v)) {
              u++; continue;
            }
            const m = _matAt(mat, size, axis, slice, u, v);
            let uLen = 1;
            while (u + uLen < size
                && !emitted[v * size + (u + uLen)]
                && frontIsSolid(u + uLen, v)
                && !backIsSolid(u + uLen, v)
                && _matAt(mat, size, axis, slice, u + uLen, v) === m) {
              uLen++;
            }
            let vLen = 1;
            outer:
            while (v + vLen < size) {
              for (let du = 0; du < uLen; du++) {
                if (emitted[(v + vLen) * size + (u + du)]
                    || !frontIsSolid(u + du, v + vLen)
                    || backIsSolid(u + du, v + vLen)
                    || _matAt(mat, size, axis, slice, u + du, v + vLen) !== m) {
                  break outer;
                }
              }
              vLen++;
            }
            for (let dv = 0; dv < vLen; dv++)
              for (let du = 0; du < uLen; du++)
                emitted[(v + dv) * size + (u + du)] = 1;
            const w = axis, uu = (axis + 1) % 3, vv = (axis + 2) % 3;
            const pos = [0, 0, 0];
            const dims = [0, 0, 0];
            pos[w]  = slice + (dir > 0 ? 1 : 0);
            pos[uu] = u;
            pos[vv] = v;
            dims[uu] = uLen;
            dims[vv] = vLen;
            const normal = [0, 0, 0];
            normal[w] = dir;
            quads.push({
              x0: pos[0],                 y0: pos[1],                 z0: pos[2],
              x1: pos[0] + dims[0],       y1: pos[1] + dims[1],       z1: pos[2] + dims[2],
              nx: normal[0], ny: normal[1], nz: normal[2],
              materialId: m,
            });
            u += uLen;
          }
        }
      }
    }
  }

  const positions = new Float32Array(quads.length * 4 * 3);
  const normals   = new Float32Array(quads.length * 4 * 3);
  const indices   = new Uint32Array(quads.length * 6);
  for (let i = 0; i < quads.length; i++) {
    const q = quads[i]!;
    const o = i * 4 * 3;
    const x = q.x0, y = q.y0, z = q.z0;
    const x1 = q.x1, y1 = q.y1, z1 = q.z1;
    positions[o + 0] = x;  positions[o + 1] = y;  positions[o + 2] = z;
    positions[o + 3] = x1; positions[o + 4] = y;  positions[o + 5] = z;
    positions[o + 6] = x1; positions[o + 7] = y1; positions[o + 8] = z1;
    positions[o + 9] = x;  positions[o +10] = y1; positions[o +11] = z1;
    for (let k = 0; k < 4; k++) {
      normals[o + k * 3 + 0] = q.nx;
      normals[o + k * 3 + 1] = q.ny;
      normals[o + k * 3 + 2] = q.nz;
    }
    const io = i * 6;
    const vi = i * 4;
    indices[io + 0] = vi;
    indices[io + 1] = vi + 1;
    indices[io + 2] = vi + 2;
    indices[io + 3] = vi;
    indices[io + 4] = vi + 2;
    indices[io + 5] = vi + 3;
  }
  return { positions, normals, indices };
}
