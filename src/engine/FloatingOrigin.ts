import { TransformNode, Scene, Matrix, Vector3 } from '@babylonjs/core';

/**
 * FloatingOrigin — prevents floating-point jitter at planetary scale.
 *
 * Strategy:
 *   - Player's absolute world position is stored as Float64 (double precision) on the CPU.
 *   - Each frame the render world is translated so the player sits near (0,0,0).
 *   - When the player drifts > RE_ANCHOR_THRESHOLD metres from the current origin,
 *     the origin is re-snapped and all scene nodes are shifted accordingly.
 *
 * Usage:
 *   const fo = new FloatingOrigin(scene);
 *   fo.setWorldPosition(x64, y64, z64);  // call whenever position changes
 *   // in your render loop: fo.update() is called automatically via scene.onBeforeRenderObservable
 */

const RE_ANCHOR_THRESHOLD = 10_000; // units — re-anchor when player drifts this far from render origin (walk mode: metres)

export class FloatingOrigin {
  /** Absolute world position (double-precision) */
  readonly worldPos = new Float64Array(3);  // [x, y, z] in metres

  /** Current render-origin anchor (double-precision) */
  private _anchor = new Float64Array(3);

  /** Root TransformNode — all scene geometry must be parented here */
  readonly root: TransformNode;

  private _scene: Scene;

  constructor(scene: Scene) {
    this._scene = scene;
    this.root = new TransformNode('__floatingOriginRoot', scene);

    // Shift the world before every render frame
    scene.onBeforeRenderObservable.add(() => this._update());
  }

  /**
   * Set the player's absolute world position in metres (double precision).
   * Call this whenever player position changes (physics tick, teleport, etc.)
   */
  setWorldPosition(x: number, y: number, z: number): void {
    this.worldPos[0] = x;
    this.worldPos[1] = y;
    this.worldPos[2] = z;
  }

  /**
   * Returns the current render-space offset of an absolute world position.
   * Use this to place scene objects at the correct render-space location.
   */
  toRenderSpace(absX: number, absY: number, absZ: number): Vector3 {
    return new Vector3(
      absX - this._anchor[0],
      absY - this._anchor[1],
      absZ - this._anchor[2]
    );
  }

  /** Called each frame — re-anchors and shifts root node if threshold exceeded. */
  private _update(): void {
    const dx = this.worldPos[0] - this._anchor[0];
    const dy = this.worldPos[1] - this._anchor[1];
    const dz = this.worldPos[2] - this._anchor[2];

    const dist2 = dx * dx + dy * dy + dz * dz;

    if (dist2 > RE_ANCHOR_THRESHOLD * RE_ANCHOR_THRESHOLD) {
      // Re-anchor: snap origin to player
      this._anchor[0] = this.worldPos[0];
      this._anchor[1] = this.worldPos[1];
      this._anchor[2] = this.worldPos[2];
    }

    // The root node's position is the negative render offset
    // (world shifts around the player, player stays near 0,0,0)
    const renderOffsetX = -(this.worldPos[0] - this._anchor[0]);
    const renderOffsetY = -(this.worldPos[1] - this._anchor[1]);
    const renderOffsetZ = -(this.worldPos[2] - this._anchor[2]);

    this.root.position.set(renderOffsetX, renderOffsetY, renderOffsetZ);
  }

  /**
   * Returns a 4×4 transform matrix that converts absolute world coords
   * to current render-space coords. Useful for shader uniform uploads.
   */
  getWorldToRenderMatrix(): Matrix {
    const tx = this._anchor[0] - this.worldPos[0];
    const ty = this._anchor[1] - this.worldPos[1];
    const tz = this._anchor[2] - this.worldPos[2];
    return Matrix.Translation(tx, ty, tz);
  }

  dispose(): void {
    this._scene.onBeforeRenderObservable.removeCallback(() => this._update());
    this.root.dispose();
  }
}
