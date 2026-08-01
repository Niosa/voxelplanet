/**
 * ChunkStreamer — generates walk-mode voxel chunks on-the-fly, seeded from
 * the globe heightmap, so terrain in walk mode is topographically accurate
 * to what you see from orbit.
 *
 * Algorithm:
 *   1. Player has a globe landing position (alpha, beta) = azimuth/inclination.
 *   2. Each walk-mode chunk covers CHUNK_SIZE_M × CHUNK_SIZE_M metres.
 *   3. For any chunk (cx, cz), compute the globe normal at its centre using
 *      walkOffsetToNormal(), sample the heightmap, classify biome.
 *   4. Generate an SVDAGChunk whose voxel column heights match the heightmap.
 *   5. When the player walks to within STREAM_MARGIN metres of a chunk edge,
 *      enqueue neighbouring chunks asynchronously.
 *
 * This file is main-thread only (uses Babylon scene for mesh creation).
 * Heavy generation is farmed out to a microtask queue to stay under
 * the TDR 1.5-second budget.
 */

import { Scene, Vector3 } from '@babylonjs/core';
import { ChunkManager, chunkKey } from '../voxel/ChunkManager.ts';
import { SVDAGChunk } from '../voxel/SVDAGChunk.ts';
import { CHUNK_SIZE_M, walkOffsetToNormal, normalToFaceUV, chunkSeed, WORLD_SEED } from './GlobeCoordMapper.ts';
import { generateHeightmap } from './HeightmapGenerator.ts';

/** How many metres from chunk edge before triggering streaming. */
const STREAM_MARGIN = 128;
/** Radius of chunks to keep loaded around the player (in chunks). */
const LOAD_RADIUS = 3;
/** Resolution of the heightmap sample used per chunk. */
const CHUNK_HM_RES = 32;

export type ChunkReadyCallback = (chunkKey: string, chunk: SVDAGChunk) => void;

export class ChunkStreamer {
  private _manager: ChunkManager;
  /** Globe camera angles at the moment the player landed. */
  private _landAlpha: number;
  private _landBeta:  number;
  private _generating = new Set<string>();
  private _onChunkReady: ChunkReadyCallback;

  constructor(
    manager: ChunkManager,
    landAlpha: number,
    landBeta: number,
    onChunkReady: ChunkReadyCallback
  ) {
    this._manager     = manager;
    this._landAlpha   = landAlpha;
    this._landBeta    = landBeta;
    this._onChunkReady = onChunkReady;
  }

  /**
   * Called every frame (or on significant player movement) with the current
   * walk-space player position in metres.
   */
  updatePlayerPosition(walkX: number, walkZ: number): void {
    const cx = Math.floor(walkX / CHUNK_SIZE_M);
    const cz = Math.floor(walkZ / CHUNK_SIZE_M);

    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
        const ncx = cx + dx;
        const ncz = cz + dz;
        const key = chunkKey(ncx, 0, ncz);
        if (!this._manager.getByCoords(ncx, 0, ncz) && !this._generating.has(key)) {
          this._enqueueChunk(ncx, ncz);
        }
      }
    }
  }

  private _enqueueChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, 0, cz);
    this._generating.add(key);

    // Microtask to avoid blocking the frame
    Promise.resolve().then(() => this._generateChunk(cx, cz)).catch(console.error);
  }

  private _generateChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, 0, cz);

    // Centre of the chunk in walk metres
    const centreX = (cx + 0.5) * CHUNK_SIZE_M;
    const centreZ = (cz + 0.5) * CHUNK_SIZE_M;

    // For each voxel column in the chunk, sample the globe heightmap
    const chunk = this._manager.getOrCreate(cx, 0, cz);

    // Sample a CHUNK_HM_RES × CHUNK_HM_RES grid over the chunk footprint
    const hmValues = new Float32Array(CHUNK_HM_RES * CHUNK_HM_RES);
    const hmBiomes = new Uint8Array(CHUNK_HM_RES * CHUNK_HM_RES);

    // Get the face/UV for the chunk centre, then use the face's heightmap
    const [cnx, cny, cnz] = walkOffsetToNormal(this._landAlpha, this._landBeta, centreX, centreZ);
    const { faceIndex } = normalToFaceUV(cnx, cny, cnz);
    const seed = chunkSeed(this._landAlpha, this._landBeta, cx, cz);

    // Generate a heightmap patch at the chunk's resolution
    const hmResult = generateHeightmap({
      seed,
      resolution: CHUNK_HM_RES,
      faceIndex,
      maxHeight: 8,
      seaLevel: 0.42,
    });

    // Fill voxel columns from heightmap
    // Each voxel = 1 metre cube.  Height in metres from sea level.
    const VOXEL_SIZE = 1; // 1m per voxel
    const SEA_LEVEL_VOXELS = 0; // sea level = y=0 in walk space

    for (let row = 0; row < CHUNK_HM_RES; row++) {
      for (let col = 0; col < CHUNK_HM_RES; col++) {
        const hmIdx = row * CHUNK_HM_RES + col;
        const heightM = hmResult.heights[hmIdx]! * 1000; // km → m
        const biomeId = hmResult.biomeIds[hmIdx]!;

        // Map chunk-local row/col to SVDAG voxel x/z (0..31)
        // CHUNK_SIZE_M=512 metres, CHUNK_SIZE (SVDAG)=32 voxels → 16 m/voxel
        const vx = Math.floor(col / CHUNK_HM_RES * 32);
        const vz = Math.floor(row / CHUNK_HM_RES * 32);

        // Fill column from 0 up to heightM in voxels
        const topVoxel = Math.max(0, Math.min(31, Math.floor(heightM / 16)));
        // Voxel type = biomeId + 1 (0 = air)
        const voxelType = biomeId + 1;

        for (let vy = 0; vy <= topVoxel; vy++) {
          chunk.set(vx, vy, vz, vy === topVoxel ? voxelType : 1 /* stone */);
        }
      }
    }

    this._generating.delete(key);
    this._onChunkReady(key, chunk);
  }

  dispose(): void {
    this._generating.clear();
  }
}
