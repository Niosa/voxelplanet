/**
 * WalkPinRegistry — stores named walk-mode spawn points and renders
 * billboard pin meshes on the globe surface.
 *
 * Pins are persisted to localStorage so they survive page reloads.
 */

import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
} from '@babylonjs/core';
import { PLANET_RADIUS_KM, cameraToSurfaceNormal } from './GlobeCoordMapper.ts';

export interface WalkPin {
  id:       string;
  label:    string;
  alpha:    number;
  beta:     number;
  biomeId:  number;
  spawnChunkKey: string;
  createdAt: number;
}

const STORAGE_KEY = 'voxelplanet_pins_v1';
const PIN_RADIUS  = 80;
const PIN_COLOR   = new Color3(1.0, 0.25, 0.1);

export class WalkPinRegistry {
  private _pins: Map<string, WalkPin> = new Map();
  private _meshes: Map<string, Mesh> = new Map();
  private _scene: Scene;
  private _mat: StandardMaterial;

  constructor(scene: Scene) {
    this._scene = scene;

    this._mat = new StandardMaterial('pinMat', scene);
    this._mat.diffuseColor  = PIN_COLOR;
    this._mat.emissiveColor = PIN_COLOR;
    this._mat.disableLighting = true;

    this._load();
  }

  private _load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw) as WalkPin[];
      for (const pin of arr) {
        this._pins.set(pin.id, pin);
        this._createMesh(pin);
      }
    } catch { /* corrupted storage — ignore */ }
  }

  private _save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this._pins.values())));
    } catch { /* storage quota — ignore */ }
  }

  addPin(pin: WalkPin): void {
    this._pins.set(pin.id, pin);
    this._createMesh(pin);
    this._save();
  }

  removePin(id: string): void {
    this._pins.delete(id);
    const mesh = this._meshes.get(id);
    if (mesh) { mesh.dispose(); this._meshes.delete(id); }
    this._save();
  }

  getAll(): WalkPin[] {
    return Array.from(this._pins.values());
  }

  getById(id: string): WalkPin | undefined {
    return this._pins.get(id);
  }

  setVisible(visible: boolean): void {
    for (const m of this._meshes.values()) m.isVisible = visible;
  }

  private _createMesh(pin: WalkPin): void {
    const [nx, ny, nz] = cameraToSurfaceNormal(pin.alpha, pin.beta);
    const r = PLANET_RADIUS_KM + PIN_RADIUS;

    const sphere = MeshBuilder.CreateSphere(`pin_${pin.id}`, { diameter: 120, segments: 6 }, this._scene);
    sphere.position = new Vector3(nx * r, ny * r, nz * r);
    sphere.material = this._mat;
    sphere.isPickable = true;
    sphere.metadata = { pinId: pin.id };
    this._meshes.set(pin.id, sphere);

    const stalkH = PIN_RADIUS;
    const stalk = MeshBuilder.CreateCylinder(
      `pinStalk_${pin.id}`,
      { height: stalkH, diameter: 20, tessellation: 6 },
      this._scene
    );
    const mid = new Vector3(
      nx * (PLANET_RADIUS_KM + stalkH * 0.5),
      ny * (PLANET_RADIUS_KM + stalkH * 0.5),
      nz * (PLANET_RADIUS_KM + stalkH * 0.5)
    );
    stalk.position = mid;

    // Align stalk along the surface normal using lookAt
    const normal = new Vector3(nx, ny, nz);
    const target = mid.add(normal);
    stalk.lookAt(target);
    stalk.rotation.x += Math.PI / 2;

    stalk.material = this._mat;
    stalk.isPickable = false;
    stalk.metadata = { pinStalk: true };
    stalk.setParent(sphere);
  }

  dispose(): void {
    for (const m of this._meshes.values()) m.dispose();
    this._mat.dispose();
  }
}

export function newPinId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
