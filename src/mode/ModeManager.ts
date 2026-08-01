/**
 * ModeManager — orchestrates Globe ↔ Walk mode transitions.
 */

import { Scene, ArcRotateCamera, Mesh } from '@babylonjs/core';
import { BasicWalkScene } from '../voxel/BasicWalkScene.ts';
import { ChunkManager } from '../voxel/ChunkManager.ts';
import { chunkKey } from '../voxel/ChunkManager.ts';
import { ChunkStreamer } from '../globe/ChunkStreamer.ts';
import { GlobePatcher } from '../globe/GlobePatcher.ts';
import { WalkPinRegistry, newPinId, type WalkPin } from '../globe/WalkPinRegistry.ts';
import { sampleGlobeAtCamera } from '../globe/GlobeCoordMapper.ts';
import { GlobeToolbar } from '../globe/GlobeToolbar.ts';
import type { HUD } from '../ui/HUD.ts';
import type { FloatingOrigin } from '../engine/FloatingOrigin.ts';

export class ModeManager {
  private _mode: 'globe' | 'walk' = 'globe';
  private _walkScene: BasicWalkScene | null = null;
  private _globeMeshes: Mesh[] = [];
  private _scene: Scene;
  private _globeCamera: ArcRotateCamera;
  private _hud: HUD;
  private _floatingOrigin: FloatingOrigin;

  private _chunkManager: ChunkManager;
  private _chunkStreamer: ChunkStreamer | null = null;
  private _globePatcher: GlobePatcher | null = null;
  private _pinRegistry: WalkPinRegistry;
  private _toolbar: GlobeToolbar;

  constructor(
    scene: Scene,
    globeCamera: ArcRotateCamera,
    floatingOrigin: FloatingOrigin,
    hud: HUD,
  ) {
    this._scene          = scene;
    this._globeCamera    = globeCamera;
    this._hud            = hud;
    this._floatingOrigin = floatingOrigin;

    this._chunkManager = new ChunkManager();
    this._pinRegistry  = new WalkPinRegistry(scene);
    this._toolbar      = new GlobeToolbar(() => ({
      alpha: this._globeCamera.alpha,
      beta:  this._globeCamera.beta,
    }));

    const canvas = this._scene.getEngine().getRenderingCanvas()!;

    canvas.addEventListener('click', () => {
      if (this._mode === 'walk' && !document.pointerLockElement) {
        canvas.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      if (this._mode === 'walk') {
        const locked = document.pointerLockElement === canvas;
        this._hud.showLockPrompt(!locked);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this._mode === 'walk') {
        if (!document.pointerLockElement) void this.exitToGlobe();
      }
      if (e.code === 'KeyM' && this._mode === 'walk') {
        void this.exitToGlobe();
      }
    });

    this._hud.onLandClicked(() => void this.enterWalkMode());
    this._hud.onExitClicked(() => void this.exitToGlobe());
    this._hud.onReturnToPinClicked((pinId: string) => void this.returnToPin(pinId));

    scene.onPointerObservable.add((pi) => {
      if (this._mode !== 'globe') return;
      if (pi.type !== 1 /* POINTERDOWN */) return;
      const mesh = pi.pickInfo?.pickedMesh;
      if (mesh?.metadata?.['pinId']) {
        const pin = this._pinRegistry.getById(mesh.metadata['pinId'] as string);
        if (pin) this._hud.showPinReturnPrompt(pin);
      }
    });
  }

  get mode(): 'globe' | 'walk' { return this._mode; }

  registerGlobeMeshes(meshes: Mesh[]): void {
    this._globeMeshes = meshes;
    if (!this._globePatcher) {
      this._globePatcher = new GlobePatcher({
        faceMeshes: meshes,
        faceResolution: 128,
        seed: 42,
      });
    }
  }

  async enterWalkMode(fromPin?: WalkPin): Promise<void> {
    if (this._mode === 'walk') return;

    const alpha = fromPin?.alpha ?? this._globeCamera.alpha;
    const beta  = fromPin?.beta  ?? this._globeCamera.beta;

    const sample = sampleGlobeAtCamera(alpha, beta);
    const biomeId = sample.biomeId;
    const spawnY  = Math.max(0, sample.height) + 1.75;
    const seed    = Math.round(alpha * 1000 + beta * 500) | 0;

    let pinId = fromPin?.id ?? null;
    if (!pinId) {
      const spawnChunk = chunkKey(0, 0, 0);
      const pin: WalkPin = {
        id:            newPinId(),
        label:         `Pin @ ${alpha.toFixed(2)}, ${beta.toFixed(2)}`,
        alpha, beta, biomeId,
        spawnChunkKey: spawnChunk,
        createdAt:     Date.now(),
      };
      this._pinRegistry.addPin(pin);
      pinId = pin.id;
      this._hud.refreshPinList(this._pinRegistry.getAll());
    }
    void pinId;

    await this._hud.transition(() => {
      this._mode = 'walk';
      for (const m of this._globeMeshes) m.isVisible = false;
      this._pinRegistry.setVisible(false);
      this._toolbar.hide();

      this._walkScene = new BasicWalkScene(this._scene, biomeId, seed, spawnY);
      this._scene.activeCamera = this._walkScene.camera;
      this._hud.showWalkMode(biomeId);
      this._hud.showLockPrompt(true);
    });

    this._chunkStreamer = new ChunkStreamer(
      this._chunkManager,
      alpha, beta,
      (_key, _chunk) => { /* future: mesh chunk and add to scene */ }
    );
    this._chunkStreamer.updatePlayerPosition(0, 0);

    const canvas = this._scene.getEngine().getRenderingCanvas()!;
    canvas.requestPointerLock().catch(() => this._hud.showLockPrompt(true));
  }

  async exitToGlobe(): Promise<void> {
    if (this._mode === 'globe') return;
    if (document.pointerLockElement) document.exitPointerLock();

    await this._hud.transition(() => {
      this._mode = 'globe';
      this._walkScene?.dispose();
      this._walkScene = null;
      this._chunkStreamer?.dispose();
      this._chunkStreamer = null;

      for (const m of this._globeMeshes) m.isVisible = true;
      this._pinRegistry.setVisible(true);
      this._toolbar.show();
      this._scene.activeCamera = this._globeCamera;
      this._hud.showGlobeMode();
    });
  }

  async returnToPin(pinId: string): Promise<void> {
    const pin = this._pinRegistry.getById(pinId);
    if (!pin) return;

    if (this._mode === 'walk') await this.exitToGlobe();

    this._globeCamera.alpha  = pin.alpha;
    this._globeCamera.beta   = pin.beta;
    this._globeCamera.radius = 6_380 + 200;

    await this.enterWalkMode(pin);
  }

  updateFrame(fpsRounded: number): void {
    if (this._mode === 'globe') {
      const altKm = Math.max(0, this._globeCamera.radius - 6371);
      this._hud.updateAltitude(altKm);
      this._hud.updateFPS(fpsRounded);
    } else if (this._mode === 'walk' && this._walkScene) {
      const pos = this._walkScene.camera.position;
      this._hud.updateWalkCoords(pos.x, pos.y, pos.z);
      this._hud.updateFPS(fpsRounded);
      this._floatingOrigin.setWorldPosition(pos.x, pos.y, pos.z);
      this._chunkStreamer?.updatePlayerPosition(pos.x, pos.z);
    }
  }
}
