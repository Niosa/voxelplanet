/**
 * VoxelGlobeBridge — projects walk-mode chunk meshes onto the globe surface
 * so that player-built structures appear when viewed from orbit.
 *
 * For each chunk in the ChunkManager, the bridge:
 *   1. Runs GreedyMesh on the solid voxel volume.
 *   2. Converts the resulting positions from walk-local space to globe-surface
 *      space using the chunk's globe anchor (alpha, beta).
 *   3. Creates or updates a Babylon Mesh at the correct globe-surface position.
 *
 * This file is intentionally lightweight; the heavy per-chunk meshing runs
 * inside ChunkStreamer's generation microtasks.
 */

import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3 } from '@babylonjs/core';
import { ChunkManager } from '../voxel/ChunkManager.ts';
import { SVDAGChunk } from '../voxel/SVDAGChunk.ts';
import { greedyMesh } from '../voxel/GreedyMesher.ts';
import { PLANET_RADIUS_KM, CHUNK_SIZE_M, walkOffsetToNormal } from './GlobeCoordMapper.ts';

const CHUNK_VOXEL_SIZE = 32;

export class VoxelGlobeBridge {
  private _scene: Scene;
  private _chunkManager: ChunkManager;
  private _landAlpha: number;
  private _landBeta:  number;
  private _meshes: Map<string, Mesh> = new Map();
  private _mat: StandardMaterial;

  constructor(
    scene: Scene,
    chunkManager: ChunkManager,
    landAlpha: number,
    landBeta: number,
  ) {
    this._scene        = scene;
    this._chunkManager = chunkManager;
    this._landAlpha    = landAlpha;
    this._landBeta     = landBeta;

    this._mat = new StandardMaterial('voxelGlobeMat', scene);
    this._mat.diffuseColor  = new Color3(0.7, 0.55, 0.4);
    this._mat.specularColor = Color3.Black();
  }

  /**
   * Rebuild globe-surface meshes for all dirty chunks.
   * Call this periodically (e.g. every 5 seconds) rather than every frame.
   */
  rebuild(): void {
    // Iterate all loaded chunks via the LRU iterator
    for (const chunk of this._chunkManager.chunksByLRU()) {
      this._rebuildChunk(chunk);
    }
  }

  private _rebuildChunk(chunk: SVDAGChunk): void {
    const key = `${chunk.cx},${chunk.cy},${chunk.cz}`;

    // Build flat solid + material arrays from the SVDAG chunk
    const size   = CHUNK_VOXEL_SIZE;
    const vol    = size * size * size;
    const solid  = new Uint8Array(vol);
    const mat    = new Uint8Array(vol);

    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        for (let z = 0; z < size; z++) {
          const v = chunk.get(x, y, z);
          const i = x * size * size + y * size + z;
          solid[i] = v !== 0 ? 1 : 0;
          mat[i]   = v & 0xff;
        }
      }
    }

    const { positions, normals, indices } = greedyMesh(solid, mat, size);
    if (positions.length === 0) return;

    // Convert chunk-local walk positions to globe-surface world positions.
    // Chunk centre in walk metres:
    const centreX = (chunk.cx + 0.5) * CHUNK_SIZE_M;
    const centreZ = (chunk.cz + 0.5) * CHUNK_SIZE_M;
    const [nnx, nny, nnz] = walkOffsetToNormal(this._landAlpha, this._landBeta, centreX, centreZ);
    const surfaceR = PLANET_RADIUS_KM;
    // Scale factor: 1 voxel at CHUNK_SIZE_M/size metres = X km
    const voxelKm = (CHUNK_SIZE_M / size) / 1000;

    // Project every vertex onto the globe surface
    const globalPositions = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      const lx = (positions[i]!   - size / 2) * voxelKm;
      const ly = (positions[i+1]! - size / 2) * voxelKm;
      const lz = (positions[i+2]! - size / 2) * voxelKm;
      // Tangent-plane projection: surface normal is (nnx, nny, nnz)
      // Build two tangent vectors
      const tx = Math.abs(nnx) < 0.9 ? 1 : 0, ty = 0, tz = Math.abs(nnx) < 0.9 ? 0 : 1;
      const bx = nny * tz - nnz * ty, by = nnz * tx - nnx * tz, bz = nnx * ty - nny * tx;
      const blen = Math.sqrt(bx*bx + by*by + bz*bz) || 1;
      const bnx = bx/blen, bny = by/blen, bnz = bz/blen;
      const tnx2 = bny*nnz - bnz*nny, tny2 = bnz*nnx - bnx*nnz, tnz2 = bnx*nny - bny*nnx;

      globalPositions[i]   = nnx * (surfaceR + ly) + tnx2 * lx + bnx * lz;
      globalPositions[i+1] = nny * (surfaceR + ly) + tny2 * lx + bny * lz;
      globalPositions[i+2] = nnz * (surfaceR + ly) + tnz2 * lx + bnz * lz;
    }

    // Dispose old mesh and build new one
    this._meshes.get(key)?.dispose();
    const mesh = new Mesh(`voxelGlobe_${key}`, this._scene);
    const vd = new (await import('@babylonjs/core')).VertexData();
    vd.positions = globalPositions;
    vd.normals   = normals;
    vd.indices   = indices;
    vd.applyToMesh(mesh);
    mesh.material = this._mat;
    this._meshes.set(key, mesh);
  }

  setVisible(visible: boolean): void {
    for (const m of this._meshes.values()) m.isVisible = visible;
  }

  dispose(): void {
    for (const m of this._meshes.values()) m.dispose();
    this._mat.dispose();
  }
}
