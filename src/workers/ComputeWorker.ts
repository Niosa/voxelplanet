/**
 * ComputeWorker — Layer 2 compute worker (one instance per CPU core).
 *
 * Receives tasks from OrchestratorWorker and runs:
 *   - Heightmap generation (fBm simplex noise)
 *   - Biome assignment
 *   - Voronoi region computation
 *   - (Future) WASM greedy mesh / surface nets
 *
 * All imports must be pure JS — no DOM or Babylon.js.
 */

import { generateHeightmap, type HeightmapOptions } from '../globe/HeightmapGenerator.ts';
import { generateVoronoiRegions, type VoronoiOptions } from '../globe/VoronoiRegions.ts';
import { runCellularAutomata, type CAOptions } from '../globe/CellularAutomata.ts';
import { generateCubeFace, type GenerateFaceOptions } from '../globe/CubeSphere.ts';

export type ComputeTask =
  | { type: 'heightmap';  opts: HeightmapOptions }
  | { type: 'voronoi';    opts: VoronoiOptions & { biomeIds: Uint8Array } }
  | { type: 'ca';         opts: CAOptions }
  | { type: 'cubeFace';   opts: GenerateFaceOptions };

export type ComputeResponse =
  | { type: 'heightmap'; taskId: string; heights: Float32Array; biomeIds: Uint8Array; moistures: Float32Array; temperatures: Float32Array; resolution: number }
  | { type: 'voronoi';   taskId: string; seeds: unknown[]; cellMap: Uint16Array }
  | { type: 'ca';        taskId: string; density: Float32Array; width: number; height: number }
  | { type: 'cubeFace';  taskId: string; positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array; biomeIds: Uint8Array; faceIndex: number };

// Worker message handler
self.onmessage = (e: MessageEvent<{ taskId: string } & ComputeTask>) => {
  const { taskId, type, opts } = e.data;

  try {
    let response: ComputeResponse;

    switch (type) {
      case 'heightmap': {
        const result = generateHeightmap(opts as HeightmapOptions);
        response = {
          type: 'heightmap', taskId,
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
        response = { type: 'voronoi', taskId, seeds: result.seeds, cellMap: result.cellMap };
        self.postMessage(response, [result.cellMap.buffer] as unknown as Transferable[]);
        return;
      }

      case 'ca': {
        const result = runCellularAutomata(opts as CAOptions);
        response = { type: 'ca', taskId, density: result.density, width: result.width, height: result.height };
        self.postMessage(response, [result.density.buffer] as unknown as Transferable[]);
        return;
      }

      case 'cubeFace': {
        const result = generateCubeFace(opts as GenerateFaceOptions);
        response = {
          type: 'cubeFace', taskId,
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
    }
  } catch (err) {
    self.postMessage({ type: 'error', taskId, message: String(err) });
  }
};
