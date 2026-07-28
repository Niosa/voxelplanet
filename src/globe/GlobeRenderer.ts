/**
 * GlobeRenderer — wires the worker pipeline to the Babylon.js scene.
 *
 * Responsibilities:
 *   - Starts the OrchestratorWorker and requests all 6 faces.
 *   - Receives completed face geometry and creates Babylon Meshes.
 *   - Updates the loading bar during generation.
 */

import {
  type Scene,
  type AbstractEngine,
  type Mesh,
} from '@babylonjs/core';
import { BiomeMaterialAtlas, buildCubeFaceMesh } from './BiomeMaterialAtlas.ts';
import type { FloatingOrigin } from '../engine/FloatingOrigin.ts';

const PLANET_RADIUS  = 6_371;  // km (1 unit = 1 km; keeps coordinates in sane float range)
const FACE_RESOLUTION = 128;   // quads per face edge — 128×128 = 16384 quads/face
const WORLD_SEED      = 42;

export interface GlobeRendererOptions {
  scene: Scene;
  engine: AbstractEngine;
  floatingOrigin: FloatingOrigin;
  /** Called each time a face mesh is built — used to collect meshes for ModeManager */
  onFaceMesh?: (mesh: Mesh) => void;
  onProgress?: (loaded: number, total: number) => void;
  onReady?: () => void;
}

export class GlobeRenderer {
  private _scene: Scene;
  private _atlas: BiomeMaterialAtlas;
  private _orchestrator: Worker;
  private _facesLoaded = 0;
  private _onFaceMesh:  ((mesh: Mesh) => void) | undefined;
  private _onProgress: ((l: number, t: number) => void) | undefined;
  private _onReady:    (() => void) | undefined;

  constructor(opts: GlobeRendererOptions) {
    this._scene      = opts.scene;
    this._atlas      = new BiomeMaterialAtlas(opts.scene);
    this._onFaceMesh = opts.onFaceMesh;
    this._onProgress = opts.onProgress;
    this._onReady    = opts.onReady;

    // Start orchestrator worker
    this._orchestrator = new Worker(
      new URL('../workers/OrchestratorWorker.ts', import.meta.url),
      { type: 'module' }
    );

    this._orchestrator.onmessage = (e: MessageEvent) => {
      const msg = e.data as Record<string, unknown>;
      if (msg['type'] === 'faceReady') this._onFaceReady(msg);
    };

    this._orchestrator.onerror = (e) => {
      console.error('[GlobeRenderer] Orchestrator error:', e.message);
    };

    // Initialise pool in the orchestrator
    this._orchestrator.postMessage({
      type: 'init',
      workerCount: navigator.hardwareConcurrency,
    });

    // Request all 6 faces
    for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
      this._orchestrator.postMessage({
        type: 'requestFace',
        faceIndex,
        seed: WORLD_SEED,
        resolution: FACE_RESOLUTION,
        planetRadius: PLANET_RADIUS,
        priority: faceIndex,
      });
    }
  }

  private _onFaceReady(msg: Record<string, unknown>): void {
    const faceIndex   = msg['faceIndex']   as number;
    const positions   = msg['positions']   as Float32Array;
    const normals     = msg['normals']     as Float32Array;
    const uvs         = msg['uvs']         as Float32Array;
    const indices     = msg['indices']     as Uint32Array;
    const biomeIds    = msg['biomeIds']    as Uint8Array;

    // Build the mesh on the main thread (Babylon must be called from main thread)
    const mesh = buildCubeFaceMesh(
      this._scene,
      this._atlas.material,
      positions, normals, uvs, biomeIds, indices,
      faceIndex
    );
    this._onFaceMesh?.(mesh);

    this._facesLoaded++;
    this._onProgress?.(this._facesLoaded, 6);

    if (this._facesLoaded === 6) {
      console.info('[GlobeRenderer] All 6 faces loaded ✓');
      this._onReady?.();
    }
  }

  dispose(): void {
    this._orchestrator.terminate();
    this._atlas.dispose();
  }
}
