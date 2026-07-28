/**
 * ModeManager — orchestrates Globe ↔ Walk mode transitions.
 *
 * Globe mode:  ArcRotateCamera orbiting the planet.
 * Walk mode:   FreeCamera on the planet surface (BasicWalkScene).
 *
 * Transitions use a fade-to-black overlay managed by the HUD.
 */

import { Scene, ArcRotateCamera, Mesh } from '@babylonjs/core';
import { BasicWalkScene } from '../voxel/BasicWalkScene.ts';
import type { HUD } from '../ui/HUD.ts';
import type { FloatingOrigin } from '../engine/FloatingOrigin.ts';

export class ModeManager {
  private _mode: 'globe' | 'walk' = 'globe';
  private _walkScene: BasicWalkScene | null = null;
  private _globeMeshes: Mesh[] = [];
  private _scene: Scene;
  private _globeCamera: ArcRotateCamera;
  private _hud: HUD;

  constructor(
    scene: Scene,
    globeCamera: ArcRotateCamera,
    _floatingOrigin: FloatingOrigin, // reserved for Phase 4 floating-origin walk spawn
    hud: HUD,
  ) {
    this._scene       = scene;
    this._globeCamera = globeCamera;
    this._hud         = hud;
    // ── Pointer lock wiring ────────────────────────────────────────────
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
        if (!document.pointerLockElement) {
          void this.exitToGlobe();
        }
      }
    });

    // Hook HUD buttons
    this._hud.onLandClicked(() => void this.enterWalkMode());
    this._hud.onExitClicked(() => void this.exitToGlobe());
  }

  get mode(): 'globe' | 'walk' { return this._mode; }

  registerGlobeMeshes(meshes: Mesh[]): void {
    this._globeMeshes = meshes;
  }

  async enterWalkMode(): Promise<void> {
    if (this._mode === 'walk') return;

    const camY   = this._globeCamera.position.y;
    const radius  = 6371;
    const normY   = camY / radius;
    const biomeId = this._estimateBiome(normY);
    const seed    = Math.floor(this._globeCamera.alpha * 1000 + this._globeCamera.beta * 500) | 0;

    await this._hud.transition(() => {
      this._mode = 'walk';
      for (const m of this._globeMeshes) m.isVisible = false;
      this._walkScene = new BasicWalkScene(this._scene, biomeId, seed);
      this._scene.activeCamera = this._walkScene.camera;
      this._hud.showWalkMode(biomeId);
      this._hud.showLockPrompt(true);
    });

    const canvas = this._scene.getEngine().getRenderingCanvas()!;
    canvas.requestPointerLock().catch(() => {
      this._hud.showLockPrompt(true);
    });
  }

  async exitToGlobe(): Promise<void> {
    if (this._mode === 'globe') return;

    if (document.pointerLockElement) document.exitPointerLock();

    await this._hud.transition(() => {
      this._mode = 'globe';
      this._walkScene?.dispose();
      this._walkScene = null;
      for (const m of this._globeMeshes) m.isVisible = true;
      this._scene.activeCamera = this._globeCamera;
      this._hud.showGlobeMode();
    });
  }

  private _estimateBiome(normY: number): number {
    const lat = Math.abs(normY);
    if (lat > 0.80) return 7;
    if (lat > 0.65) return 6;
    if (lat > 0.55) return 8;
    const lon = ((this._globeCamera.alpha % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const t   = lon / (Math.PI * 2);
    if (t < 0.20) return 5;
    if (t < 0.40) return 3;
    if (t < 0.55) return 4;
    if (t < 0.65) return 2;
    if (t < 0.80) return 3;
    return 4;
  }

  updateFrame(fpsRounded: number): void {
    if (this._mode === 'globe') {
      const camRadius = this._globeCamera.radius;
      const altKm     = Math.max(0, camRadius - 6371);
      this._hud.updateAltitude(altKm);
      this._hud.updateFPS(fpsRounded);
    } else if (this._mode === 'walk' && this._walkScene) {
      const pos = this._walkScene.camera.position;
      this._hud.updateWalkCoords(pos.x, pos.y, pos.z);
      this._hud.updateFPS(fpsRounded);
    }
  }
}
