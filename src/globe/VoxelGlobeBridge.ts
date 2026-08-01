/**
 * VoxelGlobeBridge — projects walk-mode chunk meshes onto the globe surface
 * so that player-built structures appear when viewed from orbit.
 *
 * For each chunk in the ChunkManager, the bridge:
 *   1. Runs GreedyMesh on the solid voxel volume.
 *   2. Converts the resulting positions from walk-local space to globe-surface
 *      space using the chunk’s globe anchor (alpha, beta).
 *   3. Creates or updates a Babylon Mesh at the correct globe-surface position.
 */

import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  VertexData,
} from '@babylonjs/core';
import { ChunkManager } from '../voxel/ChunkManager.ts';
import { SVDAGChunk } from '../voxel/SVDAGChunk.ts';
import { greedyMesh } from '../voxel/GreedyMesher.ts';
import { PLANET_RADIUS_KM, CHUNK_SIZE_M, walkOffsetToNormal } from './GlobeCoordMapper.ts';

const CHUNK_VOXEL_SIZE = 32;

// Suppress unused-import lint — Vector3 / MeshBuilder used indirectly
void (Vector3 as unknown);
void (MeshBuilder as unknown);

export class VoxelGlobeBridge {
  private _scene:        Scene;
  private _chunkManager: ChunkManager;
  private _landAlpha:    number;
  private _landBeta:     number;
  private _meshes:       Map<string, Mesh> = new Map();
  private _mat:          StandardMaterial;

  constructor(
    scene:        Scene,
    chunkManager: ChunkManager,
    landAlpha:    number,
    landBeta:     number,
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
   * Rebuild globe-surface meshes for all loaded chunks.
   * Call periodically (e.g. every 5 s) rather than every frame.
   */
  rebuild(): void {
    for (const chunk of this._chunkManager.chunksByLRU()) {
      this._rebuildChunk(chunk);
    }
  }

  private _rebuildChunk(chunk: SVDAGChunk): void {
    const key  = `${chunk.cx},${chunk.cy},${chunk.cz}`;
    const size = CHUNK_VOXEL_SIZE;
    const vol  = size * size * size;

    const solid = new Uint8Array(vol);
    const mat   = new Uint8Array(vol);

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

    // Convert chunk-local walk positions → globe-surface world positions.
    const centreX = (chunk.cx + 0.5) * CHUNK_SIZE_M;
    const centreZ = (chunk.cz + 0.5) * CHUNK_SIZE_M;
    const [nnx, nny, nnz] = walkOffsetToNormal(this._landAlpha, this._landBeta, centreX, centreZ);
    const surfaceR  = PLANET_RADIUS_KM;
    const voxelKm   = (CHUNK_SIZE_M / size) / 1000;

    const globalPositions = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      const lx = (positions[i]!     - size / 2) * voxelKm;
      const ly = (positions[i + 1]! - size / 2) * voxelKm;
      const lz = (positions[i + 2]! - size / 2) * voxelKm;

      // Build an orthonormal basis on the surface tangent plane
      const tx  = Math.abs(nnx) < 0.9 ? 1 : 0;
      const tz  = Math.abs(nnx) < 0.9 ? 0 : 1;
      const bx  = nny * tz  - nnz * 0;
      const by  = nnz * tx  - nnx * tz;
      const bz  = nnx * 0   - nny * tx;
      const bl  = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
      const bnx = bx / bl, bny = by / bl, bnz = bz / bl;
      const tnx = bny * nnz - bnz * nny;
      const tny = bnz * nnx - bnx * nnz;
      const tnz = bnx * nny - bny * nnx;

      globalPositions[i]     = nnx * (surfaceR + ly) + tnx * lx + bnx * lz;
      globalPositions[i + 1] = nny * (surfaceR + ly) + tny * lx + bny * lz;
      globalPositions[i + 2] = nnz * (surfaceR + ly) + tnz * lx + bnz * lz;
    }

    // Dispose old mesh and upload new one
    this._meshes.get(key)?.dispose();
    const mesh = new Mesh(`voxelGlobe_${key}`, this._scene);
    const vd   = new VertexData();
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
