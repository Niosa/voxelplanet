/**
 * main.ts — VoxelPlanet entry point.
 *
 * Boot sequence:
 *   1. Verify crossOriginIsolated (warn if missing).
 *   2. Create WebGPU (or WebGL2 fallback) engine.
 *   3. Bootstrap Babylon scene with lighting + globe camera.
 *   4. Start GlobeRenderer (worker-driven, async face generation).
 *   5. Run the render loop.
 */

import { createEngine } from './engine/WebGPUInit.ts';
import { createScene }  from './engine/Scene.ts';
import { GlobeRenderer } from './globe/GlobeRenderer.ts';

// ── Loading screen helpers ────────────────────────────────────────────────
function setLoadingText(text: string): void {
  const el = document.getElementById('loading-sub');
  if (el) el.textContent = text;
}

function setLoadingProgress(loaded: number, total: number): void {
  const fill = document.getElementById('loading-bar-fill');
  if (fill) fill.style.width = `${Math.round((loaded / total) * 100)}%`;
}

function hideLoadingScreen(): void {
  const screen = document.getElementById('loading-screen');
  if (screen) {
    screen.classList.add('hidden');
    setTimeout(() => screen.remove(), 700);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  const canvas = document.getElementById('render-canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Missing #render-canvas element');

  setLoadingText('Initialising GPU engine…');
  const { engine, caps } = await createEngine(canvas);

  // Show WebGPU fallback warning if needed
  if (!caps.isWebGPU) {
    const warning = document.getElementById('webgpu-warning');
    if (warning) warning.style.display = 'block';
  }

  setLoadingText('Building scene…');
  const { scene, floatingOrigin } = createScene(engine);

  setLoadingText('Generating planet…');

  // Start globe generation (all 6 cube-sphere faces, off main thread)
  new GlobeRenderer({
    scene,
    engine,
    floatingOrigin,
    onProgress: (loaded, total) => {
      setLoadingProgress(loaded, total);
      setLoadingText(`Generating terrain… (${loaded}/${total} faces)`);
    },
    onReady: () => {
      setLoadingProgress(6, 6);
      setLoadingText('Ready!');
      setTimeout(hideLoadingScreen, 400);
    },
  });

  // ── Render loop ────────────────────────────────────────────────────────
  engine.runRenderLoop(() => {
    scene.render();
  });

  // ── Resize handler ─────────────────────────────────────────────────────
  window.addEventListener('resize', () => engine.resize());

  // ── Dev diagnostics ────────────────────────────────────────────────────
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__voxelPlanetEngine'] = engine;
    (window as unknown as Record<string, unknown>)['__voxelPlanetScene']  = scene;
    (window as unknown as Record<string, unknown>)['__crossOriginIsolated'] = caps.crossOriginIsolated;
    console.info('[VoxelPlanet] Dev globals: __voxelPlanetEngine, __voxelPlanetScene');
    console.info(`[VoxelPlanet] crossOriginIsolated: ${caps.crossOriginIsolated}`);
    console.info(`[VoxelPlanet] WebGPU: ${caps.isWebGPU}`);
  }
}

boot().catch(err => {
  console.error('[VoxelPlanet] Fatal boot error:', err);
  const sub = document.getElementById('loading-sub');
  if (sub) sub.textContent = `Fatal error: ${String(err)}`;
});
