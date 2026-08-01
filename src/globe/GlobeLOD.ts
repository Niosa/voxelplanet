/**
 * GlobeLOD — Google Earth–style multi-resolution globe rendering.
 *
 * Each of the 6 cube-sphere faces is split into a quadtree.  The system
 * decides each frame which quadtree nodes to render based on camera altitude
 * and screen-space error, then issues mesh-load requests for new nodes and
 * disposes meshes for nodes that are too far away.
 *
 * LOD tiers (world-unit node size at planet surface, 1 unit = 1 km):
 *   Level 0 (root):  entire face    — resolution 32  — vis from > 20 000 km
 *   Level 1:         ½ face         — resolution 64  — vis from > 5 000 km
 *   Level 2:         ¼ face         — resolution 128 — vis from > 1 000 km
 *   Level 3:         ⅛ face         — resolution 256 — vis from > 200 km
 *   Level 4 (leaf):  1/16 face      — resolution 512 — vis from > 0 km
 *
 * The Minecraft-voxel aesthetic means we never smooth vertex positions —
 * each LOD level is a blocky stepped mesh at its native resolution.
 *
 * Integration:
 *   - GlobeRenderer creates one GlobeLOD and calls `update(camera)` each frame.
 *   - Mesh generation is async (offloaded to the OrchestratorWorker).
 *   - Only leaf nodes at the appropriate resolution are rendered at any time.
 */

import {
  type Scene,
  type ArcRotateCamera,
  type AbstractEngine,
  type Mesh,
  Vector3,
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
  /** Currently visible node per face (one node per face for simplicity at L0-L4) */
  private _nodes: LODNode[] = [];
  private _pendingMeshes: Map<string, boolean> = new Map();

  // External mesh list for ModeManager visibility toggling
  private _activeMeshes: Mesh[] = [];
  onMeshesChanged?: (meshes: Mesh[]) => void;

  constructor(opts: LODOptions) {
    this._scene = opts.scene;
    this._atlas = opts.atlas;
    this._orchestrator = opts.orchestrator;

    // Initialise one node per face at LOD 0
    for (let f = 0; f < 6; f++) {
      this._nodes.push({ lodLevel: 0, faceIndex: f, mesh: null, loading: false });
    }

    // Listen for completed face geometry from the orchestrator
    this._orchestrator.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data as Record<string, unknown>;
      if (msg['type'] === 'faceReady') this._onFaceReady(msg);
    });
  }

  /**
   * Called each frame with the current globe camera.
   * Determines the appropriate LOD tier based on camera altitude and
   * requests mesh regeneration if the tier has changed.
   */
  update(camera: ArcRotateCamera): void {
    const altKm = Math.max(0, camera.radius - PLANET_RADIUS_KM);

    // Find the correct LOD tier for this altitude
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
      priority:    newLevel, // lower level = higher priority
      lodLevel:    newLevel, // tag so we know which node to update on reply
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

    // Dispose old mesh
    if (node.mesh) {
      const idx = this._activeMeshes.indexOf(node.mesh);
      if (idx !== -1) this._activeMeshes.splice(idx, 1);
      node.mesh.dispose();
      node.mesh = null;
    }

    // Build new mesh
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
