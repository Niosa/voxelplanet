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
    const canvas = _scene.getEngine().getRenderingCanvas()!;

    // Request pointer lock when user clicks the canvas in walk mode
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

    // ESC in walk mode → exit to orbit
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this._mode === 'walk') {
        if (!document.pointerLockElement) {
          // Pointer already released — go back to globe
          void this.exitToGlobe();
        }
        // If pointer locked, browser handles ESC to release lock first.
        // The pointerlockchange listener shows the prompt; user clicks ESC again.
      }
    });

    // Hook HUD buttons
    _hud.onLandClicked(() => void this.enterWalkMode());
    _hud.onExitClicked(() => void this.exitToGlobe());
  }

  get mode(): 'globe' | 'walk' { return this._mode; }

  // ── Register globe meshes (call after GlobeRenderer finishes) ────────
  registerGlobeMeshes(meshes: Mesh[]): void {
    this._globeMeshes = meshes;
  }

  // ── Enter Walk Mode ───────────────────────────────────────────────────

  async enterWalkMode(): Promise<void> {
    if (this._mode === 'walk') return;

    // Determine landing biome from camera bearing (rough approximation)
    // Phase 4 will query the SVDAG at the exact surface point
    const camY   = this._globeCamera.position.y;
    const radius  = 6371; // km
    const normY   = camY / radius; // -1..1 (latitude approximation)
    const biomeId = this._estimateBiome(normY);
    const seed    = Math.floor(this._globeCamera.alpha * 1000 + this._globeCamera.beta * 500) | 0;

    await this._hud.transition(() => {
      // Mid-transition: set up walk scene
      this._mode = 'walk';

      // Hide globe geometry
      for (const m of this._globeMeshes) m.isVisible = false;

      // Create walk scene
      this._walkScene = new BasicWalkScene(this._scene, biomeId, seed);
      this._scene.activeCamera = this._walkScene.camera;

      // Show walk HUD
      this._hud.showWalkMode(biomeId);
      this._hud.showLockPrompt(true);
    });

    // Request pointer lock after fade-in
    const canvas = this._scene.getEngine().getRenderingCanvas()!;
    canvas.requestPointerLock().catch(() => {
      // Pointer lock declined (non-user-gesture) — show prompt
      this._hud.showLockPrompt(true);
    });
  }

  // ── Exit to Globe ─────────────────────────────────────────────────────

  async exitToGlobe(): Promise<void> {
    if (this._mode === 'globe') return;

    // Release pointer lock if held
    if (document.pointerLockElement) document.exitPointerLock();

    await this._hud.transition(() => {
      this._mode = 'globe';

      // Restore globe
      this._walkScene?.dispose();
      this._walkScene = null;
      for (const m of this._globeMeshes) m.isVisible = true;

      this._scene.activeCamera = this._globeCamera;
      this._hud.showGlobeMode();
    });
  }

  // ── Biome estimator (latitude-based rough guess) ─────────────────────

  private _estimateBiome(normY: number): number {
    const lat = Math.abs(normY); // 0 = equator, 1 = poles
    if (lat > 0.80) return 7;   // Snow
    if (lat > 0.65) return 6;   // Tundra
    if (lat > 0.55) return 8;   // Mountain
    // Use camera alpha (longitude) to vary low-latitude biomes
    const lon = ((this._globeCamera.alpha % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const t   = lon / (Math.PI * 2); // 0..1
    if (t < 0.20) return 5;     // Desert
    if (t < 0.40) return 3;     // Grassland
    if (t < 0.55) return 4;     // Forest
    if (t < 0.65) return 2;     // Beach
    if (t < 0.80) return 3;     // Grassland
    return 4;                   // Forest
  }

  // ── Per-frame update (call from render loop) ─────────────────────────

  updateFrame(fpsRounded: number): void {
    if (this._mode === 'globe') {
      // Altitude above surface
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
