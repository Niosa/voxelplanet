/**
 * MeshClassifier — picks a meshing strategy for a chunk based on the
 * dominant surface biome.
 *
 * The plan's Step 7 specifies that urban / blocky biomes (IDs 7–12 in the
 * extended biome enum) trigger binary greedy meshing; everything else
 * uses surface nets. We sample up to N surface voxels per chunk and
 * tally the count of urban IDs.
 */

import { SVDAGChunk } from './SVDAGChunk.ts';
import { Biome } from '../globe/HeightmapGenerator.ts';

/** Urban biome IDs (7 = Mountain is *not* urban; see comment). */
const URBAN_BIOME_IDS: ReadonlySet<number> = new Set<number>([
  Biome.Village,  // 10
  Biome.Town,     // 11
  Biome.City,     // 12
]);

/** Fraction of sampled voxels that must be urban to classify as `blocky`. */
const BLOCKY_THRESHOLD = 0.6;

/** Maximum number of surface samples to inspect. */
const MAX_SAMPLES = 256;

export type MeshStrategy = 'blocky' | 'organic';

export function classifyChunk(chunk: SVDAGChunk): MeshStrategy {
  let urban = 0;
  let total = 0;
  chunk.forEachSolid((_x, _y, _z, voxelType) => {
    if (total >= MAX_SAMPLES) return false;
    total++;
    if (URBAN_BIOME_IDS.has(voxelType)) urban++;
    return true; // continue
  });
  if (total === 0) return 'organic';
  return urban / total >= BLOCKY_THRESHOLD ? 'blocky' : 'organic';
}

/** True if the given biome id is urban. Exported for diagnostics. */
export function isUrbanBiome(id: number): boolean {
  return URBAN_BIOME_IDS.has(id);
}
