/**
 * CubeSphere — generates a sphere approximation from 6 subdivided cube faces.
 *
 * Algorithm:
 *   1. For each face, generate an N×N grid of quad vertices on the unit cube face.
 *   2. Normalize each vertex to project it onto the unit sphere surface.
 *   3. Scale by planetRadius.
 *   4. Apply per-vertex height displacement from a heightmap Float32Array.
 *
 * Each face uses a right-hand winding order consistent with Babylon.js.
 * Face indices: 0=+Y(top), 1=-Y(bottom), 2=+X(right), 3=-X(left), 4=+Z(front), 5=-Z(back)
 */

export type FaceIndex = 0 | 1 | 2 | 3 | 4 | 5;

export interface CubeFaceGeometry {
  faceIndex: FaceIndex;
  positions: Float32Array;  // flat xyz triples
  normals: Float32Array;    // flat xyz triples (normalised sphere normals)
  uvs: Float32Array;        // flat uv pairs (0..1 per face)
  indices: Uint32Array;     // triangle indices
  biomeIds: Uint8Array;     // per-vertex biome enum (0..N)
}

/** Canonical axis vectors for each of the 6 cube faces */
const FACE_AXES: ReadonlyArray<{
  forward: [number, number, number];
  right:   [number, number, number];
  up:      [number, number, number];
}> = [
  // +Y (top)
  { forward: [0,  1,  0], right: [1, 0,  0], up: [0, 0, -1] },
  // -Y (bottom)
  { forward: [0, -1,  0], right: [1, 0,  0], up: [0, 0,  1] },
  // +X (right)
  { forward: [1,  0,  0], right: [0, 0,  1], up: [0, 1,  0] },
  // -X (left)
  { forward: [-1, 0,  0], right: [0, 0, -1], up: [0, 1,  0] },
  // +Z (front)
  { forward: [0,  0,  1], right: [-1, 0, 0], up: [0, 1,  0] },
  // -Z (back)
  { forward: [0,  0, -1], right: [1,  0,  0], up: [0, 1,  0] },
];

export interface GenerateFaceOptions {
  faceIndex: FaceIndex;
  /** Number of quads per edge (resolution). Total verts = (N+1)^2 */
  resolution: number;
  /** Planet radius in metres */
  planetRadius: number;
  /**
   * Heightmap: flat Float32Array of length resolution^2.
   * Each value is a height multiplier in metres added to the sphere surface.
   * If omitted, a flat sphere is generated.
   */
  heightmap?: Float32Array;
  /**
   * Biome IDs: flat Uint8Array of length resolution^2, one per quad cell.
   * Interpolated to vertex level by nearest-neighbour.
   */
  biomeIds?: Uint8Array;
}

/**
 * Generates the geometry for one cube-sphere face.
 * Pure function — safe to run inside a Web Worker.
 */
export function generateCubeFace(opts: GenerateFaceOptions): CubeFaceGeometry {
  const { faceIndex, resolution: N, planetRadius, heightmap, biomeIds } = opts;
  const axes = FACE_AXES[faceIndex];
  const vertCount = (N + 1) * (N + 1);

  const positions = new Float32Array(vertCount * 3);
  const normals   = new Float32Array(vertCount * 3);
  const uvs       = new Float32Array(vertCount * 2);
  const vBiomeIds = new Uint8Array(vertCount);

  let vi = 0;

  for (let row = 0; row <= N; row++) {
    for (let col = 0; col <= N; col++) {
      // Normalised face coordinates in [-1, 1]
      const s = (col / N) * 2 - 1;
      const t = (row / N) * 2 - 1;

      // Point on the cube face
      const cx = axes.forward[0] + axes.right[0] * s + axes.up[0] * t;
      const cy = axes.forward[1] + axes.right[1] * s + axes.up[1] * t;
      const cz = axes.forward[2] + axes.right[2] * s + axes.up[2] * t;

      // Normalise to sphere surface
      const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
      const nx = cx / len;
      const ny = cy / len;
      const nz = cz / len;

      // Height displacement from heightmap (nearest-neighbour sample)
      const hmCol = Math.min(Math.floor(col / N * (N - 1) + 0.5), N - 1);
      const hmRow = Math.min(Math.floor(row / N * (N - 1) + 0.5), N - 1);
      const hmIdx = hmRow * N + hmCol;
      const h = heightmap ? heightmap[hmIdx] ?? 0 : 0;

      const radius = planetRadius + h;

      positions[vi * 3 + 0] = nx * radius;
      positions[vi * 3 + 1] = ny * radius;
      positions[vi * 3 + 2] = nz * radius;

      normals[vi * 3 + 0] = nx;
      normals[vi * 3 + 1] = ny;
      normals[vi * 3 + 2] = nz;

      uvs[vi * 2 + 0] = col / N;
      uvs[vi * 2 + 1] = row / N;

      vBiomeIds[vi] = biomeIds ? (biomeIds[hmIdx] ?? 0) : 0;

      vi++;
    }
  }

  // Triangle indices (two triangles per quad)
  const quadCount = N * N;
  const indices = new Uint32Array(quadCount * 6);
  let ii = 0;
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const tl = row * (N + 1) + col;
      const tr = tl + 1;
      const bl = tl + (N + 1);
      const br = bl + 1;

      // Triangle 1 (CCW for right-hand)
      indices[ii++] = tl;
      indices[ii++] = bl;
      indices[ii++] = tr;

      // Triangle 2
      indices[ii++] = tr;
      indices[ii++] = bl;
      indices[ii++] = br;
    }
  }

  return { faceIndex, positions, normals, uvs, indices, biomeIds: vBiomeIds };
}
