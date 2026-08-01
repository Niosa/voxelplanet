/**
 * GlobeLOD — Google Earth–style multi-resolution globe rendering.
 *
 * Five LOD tiers based on camera altitude (1 unit = 1 km):
 *   L0 (root):  resolution  32  visible from > 20 000 km
 *   L1:         resolution  64  visible from >  5 000 km
 *   L2:         resolution 128  visible from >  1 000 km
 *   L3:         resolution 256  visible from >    200 km
 *   L4 (leaf):  resolution 512  visible from >      0 km
 *
 * The Minecraft-voxel aesthetic means we never smooth vertex positions —
 * each LOD level is a blocky stepped mesh at its native resolution.
 */

import {
  type Scene,
  type ArcRotateCamera,
  type AbstractEngine,
  type Mesh,
} from '@babylonjs/core';
import { BiomeMaterialAtlas, buildCubeFaceMesh } from './BiomeMaterialAtlas.ts';

export const LOD_TIERS: ReadonlyArray<{ minAltKm: number; resolution: number }> = [
  { minAltKm: 20_000, resolution:  32 },  // L0
  { minAltKm:  5_000, resolution:  64 },  // L1
  { minAltKm:  1_000, resolution: 128 },  // L2
  { minAltKm:    200, resolution: 256 },  // L3
  { minAltKm:      0, resolution: 512 },  // L4
];

const PLANET_RADIUS_KM = 6_371;
const WORLD_SEED = 42;

export interface LODOptions {
  scene: Scene;
  engine: AbstractEngine;
  atlas: BiomeMaterialAtlas;
  orchestrator: Worker;
}

interface LODNode {
  lodLevel: number;
  faceIndex: number;
  mesh: Mesh | null;
  loading: boolean;
}

export class GlobeLOD {
  private _scene: Scene;
  private _atlas: BiomeMaterialAtlas;
  private _orchestrator: Worker;
  private _nodes: LODNode[] = [];
  private _pendingMeshes: Map<string, boolean> = new Map();

  private _activeMeshes: Mesh[] = [];
  onMeshesChanged?: (meshes: Mesh[]) => void;

  constructor(opts: LODOptions) {
    this._scene = opts.scene;
    this._atlas = opts.atlas;
    this._orchestrator = opts.orchestrator;

    for (let f = 0; f < 6; f++) {
      this._nodes.push({ lodLevel: 0, faceIndex: f, mesh: null, loading: false });
    }

    this._orchestrator.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data as Record<string, unknown>;
      if (msg['type'] === 'faceReady') this._onFaceReady(msg);
    });
  }

  update(camera: ArcRotateCamera): void {
    const altKm = Math.max(0, camera.radius - PLANET_RADIUS_KM);

    let targetLevel = 0;
    for (let i = LOD_TIERS.length - 1; i >= 0; i--) {
      if (altKm >= LOD_TIERS[i]!.minAltKm) {
        targetLevel = i;
        break;
      }
    }

    for (const node of this._nodes) {
      if (node.lodLevel !== targetLevel && !node.loading) {
        this._transitionNode(node, targetLevel);
      }
    }
  }

  private _transitionNode(node: LODNode, newLevel: number): void {
    const tier = LOD_TIERS[newLevel]!;
    const reqKey = `${node.faceIndex}_${newLevel}`;
    if (this._pendingMeshes.has(reqKey)) return;

    node.loading = true;
    this._pendingMeshes.set(reqKey, true);

    this._orchestrator.postMessage({
      type: 'requestFace',
      faceIndex:   node.faceIndex,
      seed:        WORLD_SEED,
      resolution:  tier.resolution,
      planetRadius: PLANET_RADIUS_KM,
      priority:    newLevel,
      lodLevel:    newLevel,
    });
  }

  private _onFaceReady(msg: Record<string, unknown>): void {
    const faceIndex = msg['faceIndex'] as number;
    const lodLevel  = (msg['lodLevel'] as number) ?? 0;
    const reqKey    = `${faceIndex}_${lodLevel}`;

    const positions = msg['positions'] as Float32Array;
    const normals   = msg['normals']   as Float32Array;
    const uvs       = msg['uvs']       as Float32Array;
    const indices   = msg['indices']   as Uint32Array;
    const biomeIds  = msg['biomeIds']  as Uint8Array;

    const node = this._nodes[faceIndex];
    if (!node) return;

    if (node.mesh) {
      const idx = this._activeMeshes.indexOf(node.mesh);
      if (idx !== -1) this._activeMeshes.splice(idx, 1);
      node.mesh.dispose();
      node.mesh = null;
    }

    const mesh = buildCubeFaceMesh(
      this._scene, this._atlas.material,
      positions, normals, uvs, biomeIds, indices,
      faceIndex
    );
    node.mesh = mesh;
    node.lodLevel = lodLevel;
    node.loading = false;
    this._pendingMeshes.delete(reqKey);

    this._activeMeshes.push(mesh);
    this.onMeshesChanged?.(this._activeMeshes.slice());
  }

  get activeMeshes(): Mesh[] {
    return this._activeMeshes.slice();
  }

  setVisible(visible: boolean): void {
    for (const m of this._activeMeshes) m.isVisible = visible;
  }

  dispose(): void {
    for (const node of this._nodes) node.mesh?.dispose();
    this._atlas.dispose();
  }
}
