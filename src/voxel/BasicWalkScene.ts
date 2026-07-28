/**
 * BasicWalkScene — placeholder first-person surface scene for Phase 4.
 *
 * Creates a local metre-scale environment (1 Babylon unit = 1 metre) at
 * origin. All globe meshes are hidden during walk mode; this scene's objects
 * are at origin and are separate from the globe coordinate space.
 *
 * Biome-specific appearances:
 *   - Ground color, fog, sky, vegetation/buildings vary by biome.
 *   - Full SVDAG procedural terrain comes in Phase 4.
 */

import {
  Scene,
  FreeCamera,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  HemisphericLight,
  DirectionalLight,
  Mesh,
} from '@babylonjs/core';
import { Biome } from '../globe/HeightmapGenerator.ts';

interface BiomeDef {
  sky:     Color4;
  fog:     Color3;
  ground:  Color3;
  hasTrees:     boolean;
  hasBuildings: boolean;
  fogDensity: number;
}

const BIOME_DEFS: Partial<Record<number, BiomeDef>> = {
  [Biome.Ocean]: {
    sky: new Color4(0.10, 0.25, 0.55, 1),
    fog: new Color3(0.15, 0.35, 0.65),
    ground: new Color3(0.12, 0.35, 0.68),
    hasTrees: false, hasBuildings: false, fogDensity: 0.006,
  },
  [Biome.Beach]: {
    sky: new Color4(0.50, 0.72, 0.95, 1),
    fog: new Color3(0.72, 0.80, 0.90),
    ground: new Color3(0.88, 0.80, 0.54),
    hasTrees: false, hasBuildings: false, fogDensity: 0.004,
  },
  [Biome.Grassland]: {
    sky: new Color4(0.38, 0.60, 0.92, 1),
    fog: new Color3(0.60, 0.76, 0.90),
    ground: new Color3(0.30, 0.58, 0.18),
    hasTrees: true, hasBuildings: false, fogDensity: 0.003,
  },
  [Biome.Forest]: {
    sky: new Color4(0.22, 0.48, 0.62, 1),
    fog: new Color3(0.30, 0.52, 0.38),
    ground: new Color3(0.12, 0.38, 0.08),
    hasTrees: true, hasBuildings: false, fogDensity: 0.006,
  },
  [Biome.Desert]: {
    sky: new Color4(0.85, 0.72, 0.50, 1),
    fog: new Color3(0.90, 0.80, 0.58),
    ground: new Color3(0.88, 0.72, 0.35),
    hasTrees: false, hasBuildings: false, fogDensity: 0.003,
  },
  [Biome.Snow]: {
    sky: new Color4(0.68, 0.76, 0.88, 1),
    fog: new Color3(0.80, 0.85, 0.95),
    ground: new Color3(0.90, 0.93, 1.0),
    hasTrees: false, hasBuildings: false, fogDensity: 0.008,
  },
  [Biome.Mountain]: {
    sky: new Color4(0.35, 0.50, 0.70, 1),
    fog: new Color3(0.55, 0.62, 0.75),
    ground: new Color3(0.50, 0.44, 0.34),
    hasTrees: false, hasBuildings: false, fogDensity: 0.004,
  },
};

const DEFAULT_BIOME = BIOME_DEFS[Biome.Grassland]!;

const BIOME_NAMES: Record<number, string> = {
  [Biome.Ocean]:      'Ocean',
  [Biome.Beach]:      'Beach',
  [Biome.Grassland]:  'Grassland',
  [Biome.Forest]:     'Forest',
  [Biome.Desert]:     'Desert',
  [Biome.Snow]:       'Snow Cap',
  [Biome.Tundra]:     'Tundra',
  [Biome.Mountain]:   'Mountain',
  [Biome.Volcanic]:   'Volcanic',
};

export function getBiomeName(id: number): string {
  return BIOME_NAMES[id] ?? 'Surface';
}

export class BasicWalkScene {
  readonly camera: FreeCamera;
  private _toDispose: { dispose(): void }[] = [];
  private _scene: Scene;
  /** Saved scene clear color to restore on exit */
  private _savedClearColor: Color4;

  constructor(scene: Scene, biomeId: number, seed: number) {
    this._scene = scene;
    this._savedClearColor = scene.clearColor.clone();

    const def = BIOME_DEFS[biomeId] ?? DEFAULT_BIOME;

    // ── Sky / fog ──────────────────────────────────────────────────────
    scene.clearColor = def.sky.clone();
    scene.fogMode    = Scene.FOGMODE_EXP2;
    scene.fogColor   = def.fog.clone();
    scene.fogDensity = def.fogDensity;

    // ── Walk camera ────────────────────────────────────────────────────
    this.camera = new FreeCamera('walkCam', new Vector3(0, 1.75, 0), scene);
    this.camera.setTarget(new Vector3(0, 1.75, 10));
    this.camera.minZ = 0.05;
    this.camera.maxZ = 2500;
    this.camera.speed = 0.12;             // ~7 m/s walking speed
    this.camera.angularSensibility = 850; // mouse look sensitivity

    // WASD keys
    this.camera.keysUp      = [87]; // W
    this.camera.keysDown    = [83]; // S
    this.camera.keysLeft    = [65]; // A
    this.camera.keysRight   = [68]; // D

    const canvas = scene.getEngine().getRenderingCanvas()!;
    this.camera.attachControl(canvas, true);

    // ── Lighting ───────────────────────────────────────────────────────
    const walkAmbient = new HemisphericLight('walkAmbient', Vector3.Up(), scene);
    walkAmbient.intensity   = 0.7;
    walkAmbient.diffuse     = new Color3(0.85, 0.90, 1.0);
    walkAmbient.groundColor = def.ground.scale(0.5);
    this._toDispose.push(walkAmbient);

    const walkSun = new DirectionalLight('walkSun', new Vector3(-0.5, -1, -0.3), scene);
    walkSun.intensity = 1.8;
    walkSun.diffuse   = new Color3(1.0, 0.96, 0.88);
    this._toDispose.push(walkSun);

    // ── Ground ─────────────────────────────────────────────────────────
    const ground = this._makeGround(def, seed);
    this._toDispose.push(ground, ground.material!);

    // ── Scenery ────────────────────────────────────────────────────────
    if (def.hasTrees)     this._spawnTrees(def, seed);
    if (def.hasBuildings) this._spawnBuildings(seed);

    // Generic city/settlement (city biome determined by Voronoi regionType;
    // for now spawn buildings whenever seed % 3 === 0 as a placeholder)
    if (seed % 3 === 0 && !def.hasBuildings) this._spawnBuildings(seed);
  }

  // ── Ground ─────────────────────────────────────────────────────────────

  private _makeGround(def: BiomeDef, seed: number): Mesh {
    const ground = MeshBuilder.CreateGround(
      'walkGround',
      { width: 1000, height: 1000, subdivisions: 20 },
      this._scene
    );

    // Dynamic texture for ground — noise pattern for visual interest
    const tex = new DynamicTexture(
      'groundTex', { width: 256, height: 256 }, this._scene, false
    );
    const ctx = tex.getContext();

    // Base color fill
    const r = Math.round(def.ground.r * 255);
    const g = Math.round(def.ground.g * 255);
    const b = Math.round(def.ground.b * 255);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, 256, 256);

    // Noise stippling for texture variation
    const rng = new LcgRng(seed);
    for (let i = 0; i < 6000; i++) {
      const px = Math.floor(rng.next() * 256);
      const py = Math.floor(rng.next() * 256);
      const v  = rng.next() < 0.5 ? -18 : 12;
      ctx.fillStyle = `rgb(${clamp(r+v,0,255)},${clamp(g+v,0,255)},${clamp(b+v,0,255)})`;
      ctx.fillRect(px, py, 2, 2);
    }
    tex.update();
    tex.uScale = 40;
    tex.vScale = 40;
    tex.wrapU = 1; // Wrap
    tex.wrapV = 1;

    const mat = new StandardMaterial('walkGroundMat', this._scene);
    mat.diffuseTexture = tex;
    mat.specularColor  = Color3.Black();
    ground.material = mat;
    this._toDispose.push(tex);

    return ground;
  }

  // ── Trees ──────────────────────────────────────────────────────────────

  private _spawnTrees(def: BiomeDef, seed: number): void {
    const rng = new LcgRng(seed + 1000);
    const count = 60 + Math.floor(rng.next() * 40);

    const trunkMat = new StandardMaterial('trunkMat', this._scene);
    trunkMat.diffuseColor = new Color3(0.35, 0.22, 0.12);
    trunkMat.specularColor = Color3.Black();
    this._toDispose.push(trunkMat);

    const leafMat = new StandardMaterial('leafMat', this._scene);
    leafMat.diffuseColor = new Color3(
      Math.min(1, def.ground.r * 1.2),
      Math.min(1, def.ground.g * 1.2),
      Math.min(1, def.ground.b * 1.2),
    );
    leafMat.specularColor = Color3.Black();
    this._toDispose.push(leafMat);

    for (let i = 0; i < count; i++) {
      const angle  = rng.next() * Math.PI * 2;
      const radius = 8 + rng.next() * 180;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const h = 3 + rng.next() * 8;

      const trunk = MeshBuilder.CreateCylinder(`tree_t_${i}`,
        { height: h, diameterTop: 0.2, diameterBottom: 0.5, tessellation: 6 },
        this._scene
      );
      trunk.position.set(x, h * 0.5, z);
      trunk.material = trunkMat;
      this._toDispose.push(trunk);

      const leaves = MeshBuilder.CreateSphere(`tree_l_${i}`,
        { diameter: 2.5 + rng.next() * 2.5, segments: 5 },
        this._scene
      );
      leaves.position.set(x, h + 1.2, z);
      leaves.material = leafMat;
      this._toDispose.push(leaves);
    }
  }

  // ── Buildings ──────────────────────────────────────────────────────────

  private _spawnBuildings(seed: number): void {
    const rng = new LcgRng(seed + 2000);
    const count = 15 + Math.floor(rng.next() * 20);

    const matA = new StandardMaterial('buildMatA', this._scene);
    matA.diffuseColor = new Color3(0.65, 0.68, 0.72);
    matA.specularColor = new Color3(0.3, 0.3, 0.3);
    this._toDispose.push(matA);

    const matB = new StandardMaterial('buildMatB', this._scene);
    matB.diffuseColor = new Color3(0.42, 0.55, 0.72);
    matB.specularColor = new Color3(0.4, 0.4, 0.5);
    this._toDispose.push(matB);

    for (let i = 0; i < count; i++) {
      const angle  = rng.next() * Math.PI * 2;
      const radius = 12 + rng.next() * 220;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const w = 4 + rng.next() * 12;
      const d = 4 + rng.next() * 12;
      const h = 5 + rng.next() * 45;

      const box = MeshBuilder.CreateBox(`bld_${i}`, { width: w, depth: d, height: h }, this._scene);
      box.position.set(x, h * 0.5, z);
      box.material = rng.next() < 0.4 ? matB : matA;
      this._toDispose.push(box);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  dispose(): void {
    this.camera.detachControl();
    this.camera.dispose();
    for (const d of this._toDispose) d.dispose();
    this._toDispose = [];
    this._scene.clearColor = this._savedClearColor;
    this._scene.fogMode    = Scene.FOGMODE_NONE;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

class LcgRng {
  private _s: number;
  constructor(seed: number) { this._s = seed >>> 0; }
  next(): number {
    this._s = (Math.imul(1664525, this._s) + 1013904223) >>> 0;
    return this._s / 0x100000000;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
