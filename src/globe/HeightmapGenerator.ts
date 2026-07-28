/**
 * HeightmapGenerator — seeded, multi-octave simplex fBm noise.
 *
 * Pure function — no DOM/Babylon dependencies. Safe to run in a Web Worker.
 *
 * Outputs per grid cell:
 *   - height in metres  (Float32Array)
 *   - biome enum        (Uint8Array)
 *   - moisture          (Float32Array, 0..1)
 *   - temperature       (Float32Array, 0..1, latitude-driven + noise)
 */

export const Biome = {
  Ocean:       0,
  Beach:       1,
  Grassland:   2,
  Forest:      3,
  Desert:      4,
  Tundra:      5,
  Snow:        6,
  Mountain:    7,
  Volcanic:    8,
  ShallowWater: 9,
} as const;

export type Biome = (typeof Biome)[keyof typeof Biome];

export interface HeightmapResult {
  heights:      Float32Array;
  biomeIds:     Uint8Array;
  moistures:    Float32Array;
  temperatures: Float32Array;
  /** Width = height = resolution */
  resolution: number;
}

export interface HeightmapOptions {
  /** RNG seed (integer) */
  seed: number;
  /** Number of samples per edge (resolution × resolution grid) */
  resolution: number;
  /** Which cube face (0-5) — used to map 2D coords to 3D sphere surface */
  faceIndex: 0 | 1 | 2 | 3 | 4 | 5;
  /** Maximum terrain height in units above sea level (default: 8, i.e. 8 km at globe scale) */
  maxHeight?: number;
  /** Sea level as a fraction of maxHeight (0..1) */
  seaLevel?: number;
}

// ---------------------------------------------------------------------------
// Minimal seeded simplex noise (no external deps)
// Based on the classic Ken Perlin simplex algorithm
// ---------------------------------------------------------------------------

function hash(n: number): number {
  n = ((n >> 16) ^ n) * 0x45d9f3b;
  n = ((n >> 16) ^ n) * 0x45d9f3b;
  n = (n >> 16) ^ n;
  return n;
}

function grad2(h: number, x: number, y: number): number {
  const hh = h & 7;
  const u = hh < 4 ? x : y;
  const v = hh < 4 ? y : x;
  return ((hh & 1) ? -u : u) + ((hh & 2) ? -v : v);
}

/** Returns a value in approximately [-1, 1] */
function simplex2(x: number, y: number, seed: number): number {
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;

  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;

  const X0 = i - t;
  const Y0 = j - t;
  const x0 = x - X0;
  const y0 = y - Y0;

  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const ii = i & 255;
  const jj = j & 255;

  const p = (n: number) => hash((n ^ seed) & 0x7fffffff) & 255;

  const gi0 = p(ii + p(jj));
  const gi1 = p(ii + i1 + p(jj + j1));
  const gi2 = p(ii + 1 + p(jj + 1));

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  const n0 = t0 < 0 ? 0 : (t0 *= t0, t0 * t0 * grad2(gi0, x0, y0));

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  const n1 = t1 < 0 ? 0 : (t1 *= t1, t1 * t1 * grad2(gi1, x1, y1));

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  const n2 = t2 < 0 ? 0 : (t2 *= t2, t2 * t2 * grad2(gi2, x2, y2));

  return 70 * (n0 + n1 + n2);
}

/**
 * Fractional Brownian Motion: sums octaves of simplex noise.
 * Returns value in approximately [-1, 1].
 */
function fBm(
  x: number, y: number, seed: number,
  octaves = 6, lacunarity = 2.0, gain = 0.5
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i++) {
    value += simplex2(x * frequency, y * frequency, seed + i * 1000) * amplitude;
    maxAmp += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return value / maxAmp;
}

/**
 * Maps a 2D face-grid (u, v) coordinate to a 3D sphere point.
 * Returns [sphereX, sphereY, sphereZ] on the unit sphere.
 */
function faceUVToSphere(
  u: number, v: number, faceIndex: number
): [number, number, number] {
  const s = u * 2 - 1; // [-1, 1]
  const t = v * 2 - 1; // [-1, 1]

  let x: number, y: number, z: number;
  switch (faceIndex) {
    case 0:  x =  s; y =  1; z = -t; break; // +Y
    case 1:  x =  s; y = -1; z =  t; break; // -Y
    case 2:  x =  1; y =  t; z =  s; break; // +X
    case 3:  x = -1; y =  t; z = -s; break; // -X
    case 4:  x = -s; y =  t; z =  1; break; // +Z
    default: x =  s; y =  t; z = -1; break; // -Z
  }

  const len = Math.sqrt(x * x + y * y + z * z);
  return [x / len, y / len, z / len];
}

/** Classify a sample point into a biome enum. */
function classifyBiome(
  normalised01Height: number,
  moisture: number,
  temperature: number,
  seaLevel: number
): Biome {
  if (normalised01Height < seaLevel - 0.15) return Biome.Ocean;
  if (normalised01Height < seaLevel - 0.02) return Biome.ShallowWater;
  if (normalised01Height < seaLevel + 0.01) return Biome.Beach;

  if (temperature < 0.15) {
    return normalised01Height > 0.75 ? Biome.Snow : Biome.Tundra;
  }
  if (normalised01Height > 0.80) return Biome.Mountain;
  if (normalised01Height > 0.70 && temperature < 0.4) return Biome.Snow;

  if (moisture < 0.25) return Biome.Desert;
  if (moisture < 0.55) return Biome.Grassland;
  return Biome.Forest;
}

/**
 * Generate a heightmap + biome grid for one cube-sphere face.
 * Pure, deterministic, and safe to call from a Web Worker.
 */
export function generateHeightmap(opts: HeightmapOptions): HeightmapResult {
  const {
    seed, resolution: N, faceIndex,
    maxHeight = 8,        // 8 km in globe-scale units
    seaLevel  = 0.42,
  } = opts;

  const count = N * N;
  const heights      = new Float32Array(count);
  const biomeIds     = new Uint8Array(count);
  const moistures    = new Float32Array(count);
  const temperatures = new Float32Array(count);

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const u = col / (N - 1);
      const v = row / (N - 1);
      const idx = row * N + col;

      const [, sy] = faceUVToSphere(u, v, faceIndex);
      // sy = sphere Y component; ranges -1 (south pole) to +1 (north pole)
      const latitude01 = (sy + 1) * 0.5; // 0 = south, 1 = north

      // Multi-octave elevation noise
      const elevNoise = fBm(u * 3, v * 3, seed, 7, 2.1, 0.48);
      const raw01 = (elevNoise + 1) * 0.5; // 0..1

      // Continental shelf — push elevations above seaLevel gently
      const elevated = raw01 < seaLevel
        ? raw01 * 0.9
        : seaLevel + (raw01 - seaLevel) * 1.3;

      heights[idx] = Math.max(0, (elevated - seaLevel)) * maxHeight;

      // Moisture noise (separate seed offset, lower frequency)
      const moistNoise = fBm(u * 2, v * 2, seed + 9999, 4, 2.0, 0.5);
      moistures[idx] = (moistNoise + 1) * 0.5;

      // Temperature: latitude-driven + small noise perturbation
      const latTemp = 1 - Math.abs(latitude01 * 2 - 1); // 0 = poles, 1 = equator
      const tempNoise = fBm(u * 4, v * 4, seed + 77777, 3, 2.0, 0.5) * 0.15;
      temperatures[idx] = Math.max(0, Math.min(1, latTemp + tempNoise));

      biomeIds[idx] = classifyBiome(
        elevated, moistures[idx], temperatures[idx], seaLevel
      );
    }
  }

  return { heights, biomeIds, moistures, temperatures, resolution: N };
}
