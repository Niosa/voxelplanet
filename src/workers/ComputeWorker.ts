/**
 * ComputeWorker — Layer 2 compute worker (one instance per CPU core).
 *
 * Receives tasks from OrchestratorWorker and runs:
 *   - Heightmap generation (fBm simplex noise)
 *   - Biome assignment
 *   - Voronoi region computation
 *   - Voxel chunk meshing (JS fallback; GPU path is on the main thread)
 *
 * All imports must be pure JS — no DOM or Babylon.js.
 */

import { generateHeightmap, type HeightmapOptions } from '../globe/HeightmapGenerator.ts';
import { generateVoronoiRegions, type VoronoiOptions } from '../globe/VoronoiRegions.ts';
import { runCellularAutomata, type CAOptions } from '../globe/CellularAutomata.ts';
import { generateCubeFace, type GenerateFaceOptions } from '../globe/CubeSphere.ts';
import { greedyMesh, type MeshBuffers } from '../voxel/GreedyMesher.ts';

export type ComputeTask =
  | { type: 'heightmap';  opts: HeightmapOptions }
  | { type: 'voronoi';    opts: VoronoiOptions & { biomeIds: Uint8Array } }
  | { type: 'ca';         opts: CAOptions }
  | { type: 'cubeFace';   opts: GenerateFaceOptions }
  | { type: 'meshChunk';  opts: MeshChunkOptions };

export interface MeshChunkOptions {
  chunkKey: string;
  voxelData: Uint8Array;
  strategy: 'blocky' | 'organic';
}

export type ComputeResponse =
  | { type: 'heightmap'; taskId: string; heights: Float32Array; biomeIds: Uint8Array; moistures: Float32Array; temperatures: Float32Array; resolution: number }
  | { type: 'voronoi';   taskId: string; seeds: unknown[]; cellMap: Uint16Array }
  | { type: 'ca';        taskId: string; density: Float32Array; width: number; height: number }
  | { type: 'cubeFace';  taskId: string; positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array; biomeIds: Uint8Array; faceIndex: number }
  | { type: 'meshChunk'; taskId: string; chunkKey: string; positions: Float32Array; normals: Float32Array; indices: Uint32Array };

self.onmessage = (e: MessageEvent<{ taskId: string } & ComputeTask>) => {
  const { taskId, type, opts } = e.data;

  try {
    switch (type) {
      case 'heightmap': {
        const result = generateHeightmap(opts as HeightmapOptions);
        const response = {
          type: 'heightmap' as const, taskId,
          heights: result.heights, biomeIds: result.biomeIds,
          moistures: result.moistures, temperatures: result.temperatures,
          resolution: result.resolution,
        };
        self.postMessage(response, [
          result.heights.buffer, result.biomeIds.buffer,
          result.moistures.buffer, result.temperatures.buffer,
        ] as unknown as Transferable[]);
        return;
      }

      case 'voronoi': {
        const { biomeIds: bIds, ...voronoiOpts } = opts as VoronoiOptions & { biomeIds: Uint8Array };
        const result = generateVoronoiRegions({ ...voronoiOpts, biomeIds: bIds });
        const response = { type: 'voronoi' as const, taskId, seeds: result.seeds, cellMap: result.cellMap };
        self.postMessage(response, [result.cellMap.buffer] as unknown as Transferable[]);
        return;
      }

      case 'ca': {
        const result = runCellularAutomata(opts as CAOptions);
        const response = { type: 'ca' as const, taskId, density: result.density, width: result.width, height: result.height };
        self.postMessage(response, [result.density.buffer] as unknown as Transferable[]);
        return;
      }

      case 'cubeFace': {
        const result = generateCubeFace(opts as GenerateFaceOptions);
        const response = {
          type: 'cubeFace' as const, taskId,
          positions: result.positions, normals: result.normals,
          uvs: result.uvs, indices: result.indices,
          biomeIds: result.biomeIds, faceIndex: result.faceIndex,
        };
        self.postMessage(response, [
          result.positions.buffer, result.normals.buffer,
          result.uvs.buffer, result.indices.buffer,
          result.biomeIds.buffer,
        ] as unknown as Transferable[]);
        return;
      }

      case 'meshChunk': {
        const m = opts as MeshChunkOptions;
        const buffers = _meshFallback(m.voxelData, m.strategy);
        const response = {
          type: 'meshChunk' as const, taskId, chunkKey: m.chunkKey,
          positions: buffers.positions, normals: buffers.normals, indices: buffers.indices,
        };
        self.postMessage(response, [
          buffers.positions.buffer, buffers.normals.buffer, buffers.indices.buffer,
        ] as unknown as Transferable[]);
        return;
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', taskId, message: String(err) });
  }
};

// ---------------------------------------------------------------------------
// Worker-side fallback mesher
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 32;

function _meshFallback(
  voxels: Uint8Array,
  strategy: 'blocky' | 'organic',
): MeshBuffers {
  if (strategy === 'blocky') {
    return greedyMesh(voxels, voxels, CHUNK_SIZE);
  }
  return _surfaceNets(voxels);
}

function _surfaceNets(voxels: Uint8Array): MeshBuffers {
  const positions: number[] = [];
  const normals:   number[] = [];
  const indices:   number[] = [];
  let vi = 0;
  for (let z = 0; z < CHUNK_SIZE - 1; z++)
    for (let y = 0; y < CHUNK_SIZE - 1; y++)
      for (let x = 0; x < CHUNK_SIZE - 1; x++) {
        const i = z * CHUNK_SIZE * CHUNK_SIZE + y * CHUNK_SIZE + x;
        const solid = voxels[i] !== 0
                   || voxels[i+1] !== 0
                   || voxels[i+CHUNK_SIZE] !== 0
                   || voxels[i+CHUNK_SIZE+1] !== 0
                   || voxels[i+CHUNK_SIZE*CHUNK_SIZE] !== 0
                   || voxels[i+CHUNK_SIZE*CHUNK_SIZE+1] !== 0
                   || voxels[i+CHUNK_SIZE*CHUNK_SIZE+CHUNK_SIZE] !== 0
                   || voxels[i+CHUNK_SIZE*CHUNK_SIZE+CHUNK_SIZE+1] !== 0;
        if (!solid) continue;
        positions.push(x + 0.5, y + 0.5, z + 0.5);
        normals.push(0, 1, 0);
        indices.push(vi, vi, vi,  vi, vi, vi);
        vi++;
      }
  return {
    positions: new Float32Array(positions),
    normals:   new Float32Array(normals),
    indices:   new Uint32Array(indices),
  };
}
