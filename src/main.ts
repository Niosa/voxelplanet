/**
 * main.ts — VoxelPlanet entry point.
 *
 * Boot sequence:
 *   1. Create HUD (DOM, synchronous).
 *   2. Create WebGPU (or WebGL2 fallback) engine.
 *   3. Bootstrap Babylon scene with lighting + globe camera.
 *   4. Start GlobeRenderer (worker-driven, async face generation).
 *   5. Register globe meshes with ModeManager.
 *   6. Run the render loop (FPS counter + mode updates).
 */

import { createEngine } from './engine/WebGPUInit.ts';
import { createScene }  from './engine/Scene.ts';
import { GlobeRenderer } from './globe/GlobeRenderer.ts';
import { ModeManager }   from './mode/ModeManager.ts';
import { HUD }           from './ui/HUD.ts';
import type { Mesh }     from '@babylonjs/core';

// ── Boot ──────────────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  const canvas = document.getElementById('render-canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Missing #render-canvas element');

  // HUD is purely DOM — safe to init before engine
  const hud = new HUD();
  hud.setLoadingText('Initialising GPU engine…');

  const { engine, caps } = await createEngine(canvas);

  if (!caps.isWebGPU) {
    const warning = document.getElementById('webgpu-warning');
    if (warning) warning.style.display = 'block';
  }

  hud.setLoadingText('Building scene…');
  const { scene, floatingOrigin, globeCamera } = createScene(engine);

  // Mode manager — wires HUD buttons to scene transitions
  const modeManager = new ModeManager(scene, globeCamera, floatingOrigin, hud);

  hud.setLoadingText('Generating planet…');

  const globeMeshes: Mesh[] = [];

  new GlobeRenderer({
    scene,
    engine,
    floatingOrigin,
    onFaceMesh: (mesh) => {
      globeMeshes.push(mesh);
      modeManager.registerGlobeMeshes(globeMeshes);
    },
    onProgress: (loaded, total) => {
      hud.setLoadingProgress(loaded, total);
      hud.setLoadingText(`Generating terrain… (${loaded}/${total} faces)`);
    },
    onReady: () => {
      hud.setLoadingProgress(6, 6);
      hud.setLoadingText('Ready!');
      setTimeout(() => {
        hud.hideLoadingScreen();
        hud.showGlobeMode();
      }, 350);
    },
  });

  // ── Render loop ──────────────────────────────────────────────────────
  let fpsAccum = 0;
  let fpsFrames = 0;
  let fpsDisplay = 0;
  let lastFpsTime = performance.now();

  engine.runRenderLoop(() => {
    scene.render();

    // FPS calculation (update every 500ms)
    fpsFrames++;
    const now = performance.now();
    fpsAccum += now - lastFpsTime;
    lastFpsTime = now;
    if (fpsAccum >= 500) {
      fpsDisplay = Math.round(fpsFrames / (fpsAccum / 1000));
      fpsFrames = 0;
      fpsAccum  = 0;
    }
    modeManager.updateFrame(fpsDisplay);
  });

  window.addEventListener('resize', () => engine.resize());

  // Dev diagnostics
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__vp'] = { engine, scene, modeManager, hud };
    console.info(
      '[VoxelPlanet] Dev: window.__vp = { engine, scene, modeManager, hud }',
      `\n  WebGPU: ${caps.isWebGPU}`,
      `\n  crossOriginIsolated: ${caps.crossOriginIsolated}`,
    );
  }
}

boot().catch(err => {
  console.error('[VoxelPlanet] Fatal boot error:', err);
  const sub = document.getElementById('loading-sub');
  if (sub) sub.textContent = `Fatal error: ${String(err)}`;
});
