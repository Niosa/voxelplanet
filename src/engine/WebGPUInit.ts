import { WebGPUEngine, Engine, type AbstractEngine } from '@babylonjs/core';

export interface EngineCapabilities {
  isWebGPU: boolean;
  crossOriginIsolated: boolean;
}

/** Singleton engine instance */
let _engine: AbstractEngine | null = null;

/**
 * Creates a WebGPUEngine if available, otherwise falls back to WebGL2 Engine.
 * Must be called once at startup. Returns the engine and capability flags.
 */
export async function createEngine(canvas: HTMLCanvasElement): Promise<{
  engine: AbstractEngine;
  caps: EngineCapabilities;
}> {
  if (_engine) {
    throw new Error('createEngine() called more than once — use getEngine() after init.');
  }

  const crossOriginIsolated = self.crossOriginIsolated;
  if (!crossOriginIsolated) {
    console.warn(
      '[VoxelPlanet] crossOriginIsolated = false. ' +
      'SharedArrayBuffer (WASM threads) will not be available. ' +
      'Ensure COOP/COEP headers are served correctly.'
    );
  }

  let isWebGPU = false;
  let engine: AbstractEngine;

  // Attempt WebGPU first
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const webGPUEngine = new WebGPUEngine(canvas, {
        antialias: true,
        adaptToDeviceRatio: true,
        // Enable large world rendering (floating-origin support)
        // This allows the engine to handle planet-scale coordinates
      });
      await webGPUEngine.initAsync();
      engine = webGPUEngine;
      isWebGPU = true;
      console.info('[VoxelPlanet] WebGPU engine initialised ✓');
    } catch (err) {
      console.warn('[VoxelPlanet] WebGPU init failed, falling back to WebGL2:', err);
      engine = new Engine(canvas, true, {
        adaptToDeviceRatio: true,
        powerPreference: 'high-performance',
      });
    }
  } else {
    console.info('[VoxelPlanet] WebGPU not available, using WebGL2');
    engine = new Engine(canvas, true, {
      adaptToDeviceRatio: true,
      powerPreference: 'high-performance',
    });
  }

  _engine = engine;

  return {
    engine,
    caps: { isWebGPU, crossOriginIsolated },
  };
}

/** Returns the active engine (throws if not yet initialised). */
export function getEngine(): AbstractEngine {
  if (!_engine) throw new Error('Engine not yet initialised — call createEngine() first.');
  return _engine;
}

/** Disposes and clears the engine singleton. */
export function disposeEngine(): void {
  _engine?.dispose();
  _engine = null;
}
