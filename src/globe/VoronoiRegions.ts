/**
 * VoronoiRegions — partitions each cube-sphere face into political/geographic regions.
 *
 * Algorithm:
 *   1. Poisson-disc sampling to place seed points with a minimum separation distance.
 *   2. For each pixel in the grid, find the nearest seed (Lloyd iteration approach).
 *   3. Tag each cell with a region type based on biome + seeded RNG.
 *
 * Pure function — no DOM/Babylon dependencies. Safe for Web Workers.
 */

export const RegionType = {
  Wilderness:  0,
  Settlement:  1,  // small village, < 500 voxel structures
  City:        2,  // dense urban, Cellular Automata for layout
  Dungeon:     3,  // underground / cave entrance
  Ruin:        4,  // ancient structure
} as const;

export type RegionType = (typeof RegionType)[keyof typeof RegionType];

export interface VoronoiSeed {
  u: number;        // 0..1 face coordinate
  v: number;        // 0..1 face coordinate
  regionType: RegionType;
  /** Unique id within this face */
  id: number;
}

export interface VoronoiCell {
  seedId: number;
  /** Grid indices belonging to this cell */
  pixelIndices: Uint32Array;
  bounds: { minU: number; minV: number; maxU: number; maxV: number };
}

export interface VoronoiResult {
  seeds: VoronoiSeed[];
  /** Per-pixel cell assignment: index = row*N+col, value = seedId */
  cellMap: Uint16Array;
  cells: Map<number, VoronoiCell>;
}

// ---------------------------------------------------------------------------
// Simple LCG RNG (deterministic, seeded)
// ---------------------------------------------------------------------------
class Rng {
  private _s: number;
  constructor(seed: number) { this._s = seed >>> 0; }
  next(): number {
    this._s = (Math.imul(1664525, this._s) + 1013904223) >>> 0;
    return this._s / 0x100000000;
  }
}

/**
 * Poisson-disc sampling on a 2D [0,1]^2 domain.
 * Returns at most maxPoints seed points with minimum separation minDist.
 */
function poissonDisc(
  minDist: number, maxPoints: number, rng: Rng
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const minDist2 = minDist * minDist;
  const MAX_ATTEMPTS = 30;

  const first: [number, number] = [rng.next(), rng.next()];
  points.push(first);
  const active = [first];

  while (active.length > 0 && points.length < maxPoints) {
    const idx = Math.floor(rng.next() * active.length);
    const [ax, ay] = active[idx]!;
    let placed = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const angle = rng.next() * Math.PI * 2;
      const radius = minDist * (1 + rng.next());
      const nx = ax + Math.cos(angle) * radius;
      const ny = ay + Math.sin(angle) * radius;

      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;

      let ok = true;
      for (const [px, py] of points) {
        const dx = nx - px, dy = ny - py;
        if (dx * dx + dy * dy < minDist2) { ok = false; break; }
      }

      if (ok) {
        const pt: [number, number] = [nx, ny];
        points.push(pt);
        active.push(pt);
        placed = true;
        break;
      }
    }

    if (!placed) active.splice(idx, 1);
  }

  return points;
}

export interface VoronoiOptions {
  seed: number;
  resolution: number;        // grid resolution (same as heightmap)
  faceIndex: number;
  /** Biome IDs per pixel — used to assign region types */
  biomeIds: Uint8Array;
  /** Min separation between seeds as fraction of face (0..1) */
  minSeedSeparation?: number;
  /** Max number of seed points per face */
  maxSeeds?: number;
}

export function generateVoronoiRegions(opts: VoronoiOptions): VoronoiResult {
  const {
    seed, resolution: N, biomeIds,
    minSeedSeparation = 0.08,
    maxSeeds = 80,
  } = opts;

  const rng = new Rng(seed ^ (opts.faceIndex * 0xdeadbeef));

  // Place seeds via Poisson disc
  const rawSeeds = poissonDisc(minSeedSeparation, maxSeeds, rng);

  const seeds: VoronoiSeed[] = rawSeeds.map(([u, v], i) => {
    // Determine region type: biome at this seed's pixel
    const col = Math.floor(u * (N - 1));
    const row = Math.floor(v * (N - 1));
    const biome = biomeIds[row * N + col] ?? 0;

    let regionType: RegionType;
    const roll = rng.next();

    // Ocean/water biomes don't get surface settlements
    if (biome === 0 || biome === 1 || biome === 9) {
      regionType = RegionType.Wilderness;
    } else if (roll < 0.05) {
      regionType = RegionType.City;
    } else if (roll < 0.18) {
      regionType = RegionType.Settlement;
    } else if (roll < 0.22) {
      regionType = RegionType.Dungeon;
    } else if (roll < 0.25) {
      regionType = RegionType.Ruin;
    } else {
      regionType = RegionType.Wilderness;
    }

    return { u, v, regionType, id: i };
  });

  // Build cell map: for each pixel, find nearest seed
  const cellMap = new Uint16Array(N * N);
  const cells = new Map<number, VoronoiCell>();

  // Initialise cell accumulators
  seeds.forEach(s => cells.set(s.id, {
    seedId: s.id,
    pixelIndices: new Uint32Array(0), // filled below
    bounds: { minU: 1, minV: 1, maxU: 0, maxV: 0 },
  }));

  const tempPixelLists = new Map<number, number[]>();
  seeds.forEach(s => tempPixelLists.set(s.id, []));

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const u = col / (N - 1);
      const v = row / (N - 1);

      let nearestId = 0;
      let nearestDist2 = Infinity;

      for (const s of seeds) {
        const du = u - s.u, dv = v - s.v;
        const d2 = du * du + dv * dv;
        if (d2 < nearestDist2) { nearestDist2 = d2; nearestId = s.id; }
      }

      const pixIdx = row * N + col;
      cellMap[pixIdx] = nearestId;
      tempPixelLists.get(nearestId)!.push(pixIdx);

      // Update bounds
      const cell = cells.get(nearestId)!;
      if (u < cell.bounds.minU) cell.bounds.minU = u;
      if (u > cell.bounds.maxU) cell.bounds.maxU = u;
      if (v < cell.bounds.minV) cell.bounds.minV = v;
      if (v > cell.bounds.maxV) cell.bounds.maxV = v;
    }
  }

  // Convert temp lists to typed arrays
  for (const [id, list] of tempPixelLists) {
    const cell = cells.get(id)!;
    cell.pixelIndices = new Uint32Array(list);
  }

  return { seeds, cellMap, cells };
}
