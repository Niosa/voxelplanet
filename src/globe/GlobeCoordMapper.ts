/**
 * GlobeCoordMapper — bidirectional mapping between globe camera space
 * (ArcRotateCamera alpha/beta/radius) and walk-world space.
 *
 * All maths uses the same constants as GlobeRenderer / HeightmapGenerator
 * so a point on the globe and a walk-spawn point sample identical terrain.
 *
 * Coordinate systems:
 *   Globe space:  1 unit = 1 km.  Planet surface at radius 6371.
 *   Walk space:   1 unit = 1 m.   Player spawns at (0, spawnY, 0).
 *
 * The mapping is:
 *   globe sphere point (unit vector n̂) = surface point at radius 6371 km.
 *   walk world is a local tangent-plane patch centred on that point.
 *   chunk grid is in walk-metres: chunkX = floor(walkX / 512), etc.
 */

import { generateHeightmap, type HeightmapOptions } from './HeightmapGenerator.ts';

export const PLANET_RADIUS_KM = 6_371;
export const WALK_METRES_PER_KM = 1_000;
export const CHUNK_SIZE_M = 512;   // one chunk = 512 × 512 metres
export const WORLD_SEED = 42;

/**
 * ArcRotateCamera angles + radius → unit surface normal + face/UV.
 * alpha = azimuth (longitude-like), beta = inclination from Y-up.
 */
export function cameraToSurfaceNormal(alpha: number, beta: number): [number, number, number] {
  // Babylon ArcRotateCamera: beta=0 → looking down +Y axis.
  // Standard spherical → Cartesian (Y-up):
  const sinB = Math.sin(beta);
  const cosB = Math.cos(beta);
  const sinA = Math.sin(alpha);
  const cosA = Math.cos(alpha);
  const x = sinB * cosA;
  const y = cosB;
  const z = sinB * sinA;
  return [x, y, z];
}

/**
 * Determine which cube face (0-5) owns a unit vector,
 * and return the face's (u,v) ∈ [0,1]².
 */
export function normalToFaceUV(nx: number, ny: number, nz: number): {
  faceIndex: 0|1|2|3|4|5;
  u: number;
  v: number;
} {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  let faceIndex: 0|1|2|3|4|5;
  let u: number, v: number;

  if (ay >= ax && ay >= az) {
    faceIndex = ny > 0 ? 0 : 1;  // +Y / -Y
    u = ny > 0 ? ( nx + 1) * 0.5 : ( nx + 1) * 0.5;
    v = ny > 0 ? (-nz + 1) * 0.5 : ( nz + 1) * 0.5;
  } else if (ax >= az) {
    faceIndex = nx > 0 ? 2 : 3;  // +X / -X
    u = nx > 0 ? ( nz + 1) * 0.5 : (-nz + 1) * 0.5;
    v = ( ny + 1) * 0.5;
  } else {
    faceIndex = nz > 0 ? 4 : 5;  // +Z / -Z
    u = nz > 0 ? (-nx + 1) * 0.5 : ( nx + 1) * 0.5;
    v = ( ny + 1) * 0.5;
  }

  return { faceIndex, u: Math.max(0, Math.min(1, u)), v: Math.max(0, Math.min(1, v)) };
}

/**
 * Sample the procedural heightmap at a globe (alpha, beta) camera position.
 * Returns { height (m above sea level), biomeId, moisture, temperature }.
 *
 * Uses resolution=64 for speed — accurate enough for spawn placement.
 */
export function sampleGlobeAtCamera(
  alpha: number,
  beta: number,
  seed = WORLD_SEED
): { height: number; biomeId: number; moisture: number; temperature: number } {
  const [nx, ny, nz] = cameraToSurfaceNormal(alpha, beta);
  const { faceIndex, u, v } = normalToFaceUV(nx, ny, nz);

  const resolution = 64;
  const opts: HeightmapOptions = { seed, resolution, faceIndex, maxHeight: 8, seaLevel: 0.42 };
  const result = generateHeightmap(opts);

  const col = Math.min(Math.floor(u * (resolution - 1) + 0.5), resolution - 1);
  const row = Math.min(Math.floor(v * (resolution - 1) + 0.5), resolution - 1);
  const idx = row * resolution + col;

  return {
    height:      result.heights[idx]! * WALK_METRES_PER_KM,  // km → m
    biomeId:     result.biomeIds[idx]!,
    moisture:    result.moistures[idx]!,
    temperature: result.temperatures[idx]!,
  };
}

/**
 * Given globe camera (alpha, beta) and a walk-mode local position (walkX, walkZ),
 * compute the globe surface normal for that position.
 *
 * walkX / walkZ are metres east/north from the spawn point.
 * Conversion: 1 m on surface ≈ 1/6371000 radians.
 */
export function walkOffsetToNormal(
  alpha: number,
  beta: number,
  walkX: number,
  walkZ: number
): [number, number, number] {
  const R = PLANET_RADIUS_KM * WALK_METRES_PER_KM; // planet radius in metres
  const dAlpha = walkX / (R * Math.sin(Math.max(0.01, beta)));
  const dBeta  = -walkZ / R;
  return cameraToSurfaceNormal(alpha + dAlpha, beta + dBeta);
}

/**
 * Deterministic per-chunk seed derived from the globe position.
 * Ensures the same chunk always generates identically regardless of traversal order.
 */
export function chunkSeed(alpha: number, beta: number, chunkX: number, chunkZ: number): number {
  // Mix globe angles and chunk coords into a stable integer seed
  const a32 = Math.round(((alpha % (Math.PI * 2)) + Math.PI * 2) * 1e4) & 0x7fff;
  const b32 = Math.round(beta * 1e4) & 0x7fff;
  const cx  = (chunkX & 0xffff);
  const cz  = (chunkZ & 0xffff);
  return ((a32 ^ (b32 << 8) ^ (cx << 3) ^ (cz << 11)) >>> 0) + WORLD_SEED;
}
