import {
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  Color3,
  Vector3,
  type AbstractEngine,
} from '@babylonjs/core';
import { FloatingOrigin } from './FloatingOrigin.ts';

export interface SceneContext {
  scene: Scene;
  floatingOrigin: FloatingOrigin;
  globeCamera: ArcRotateCamera;
}

/**
 * Bootstraps the Babylon scene: lighting, cameras, and the floating-origin root.
 * Returns the scene context for use by globe and walk subsystems.
 */
export function createScene(engine: AbstractEngine): SceneContext {
  const scene = new Scene(engine);
  scene.clearColor.set(0.01, 0.02, 0.06, 1); // Deep space background

  // --- Floating origin ---
  const floatingOrigin = new FloatingOrigin(scene);

  // --- Lighting ---
  // Ambient fill — soft blue-tinted space ambient
  const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
  ambient.intensity = 0.15;
  ambient.diffuse = new Color3(0.5, 0.6, 0.9);
  ambient.groundColor = new Color3(0.05, 0.05, 0.08);

  // Primary sun — directional light
  const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, -0.3), scene);
  sun.intensity = 2.2;
  sun.diffuse = new Color3(1.0, 0.97, 0.88);
  sun.specular = new Color3(0.8, 0.8, 0.7);

  // --- Globe camera (ArcRotate — orbit around planet centre) ---
  // Units: 1 unit = 1 km for the globe view.
  // Planet radius = 6,371 units. Start camera 8,000 km out (low orbit).
  const globeCamera = new ArcRotateCamera(
    'globeCamera',
    -Math.PI / 4,   // alpha
    Math.PI / 3,    // beta
    9_000,          // radius in km — roughly geostationary orbit
    Vector3.Zero(), // target = planet centre
    scene
  );
  globeCamera.lowerRadiusLimit = 6_380;    // 9 km above surface minimum
  globeCamera.upperRadiusLimit = 80_000;   // ~13× planet radius (far orbit)
  globeCamera.minZ = 1;                    // 1 km near clip
  globeCamera.maxZ = 200_000;              // 200,000 km far clip (deep space)
  globeCamera.wheelPrecision = 0.002;
  globeCamera.pinchPrecision = 20;
  globeCamera.attachControl(engine.getRenderingCanvas()!, true);

  return { scene, floatingOrigin, globeCamera };
}
