/**
 * ChunkStreamer — generates walk-mode voxel chunks on-the-fly, seeded from
 * the globe heightmap, so terrain in walk mode is topographically accurate
 * to what you see from orbit.
 */

import { ChunkManager, chunkKey } from '../voxel/ChunkManager.ts';
import { SVDAGChunk } from '../voxel/SVDAGChunk.ts';
import { CHUNK_SIZE_M, walkOffsetToNormal, normalToFaceUV, chunkSeed } from './GlobeCoordMapper.ts';
import { generateHeightmap } from './HeightmapGenerator.ts';

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
    Promise.resolve().then(() => this._generateChunk(cx, cz)).catch(console.error);
  }

  private _generateChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, 0, cz);

    const centreX = (cx + 0.5) * CHUNK_SIZE_M;
    const centreZ = (cz + 0.5) * CHUNK_SIZE_M;

    const chunk = this._manager.getOrCreate(cx, 0, cz);

    const [cnx, cny, cnz] = walkOffsetToNormal(this._landAlpha, this._landBeta, centreX, centreZ);
    const { faceIndex } = normalToFaceUV(cnx, cny, cnz);
    const seed = chunkSeed(this._landAlpha, this._landBeta, cx, cz);

    const hmResult = generateHeightmap({
      seed,
      resolution: CHUNK_HM_RES,
      faceIndex,
      maxHeight: 8,
      seaLevel: 0.42,
    });

    for (let row = 0; row < CHUNK_HM_RES; row++) {
      for (let col = 0; col < CHUNK_HM_RES; col++) {
        const hmIdx = row * CHUNK_HM_RES + col;
        const heightM = hmResult.heights[hmIdx]! * 1000;
        const biomeId = hmResult.biomeIds[hmIdx]!;

        const vx = Math.floor(col / CHUNK_HM_RES * 32);
        const vz = Math.floor(row / CHUNK_HM_RES * 32);
        const topVoxel = Math.max(0, Math.min(31, Math.floor(heightM / 16)));
        const voxelType = biomeId + 1;

        for (let vy = 0; vy <= topVoxel; vy++) {
          chunk.set(vx, vy, vz, vy === topVoxel ? voxelType : 1);
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
