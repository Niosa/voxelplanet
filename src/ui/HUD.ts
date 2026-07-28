/**
 * HUD — manages all DOM overlay elements.
 * The HUD is pure DOM; it never touches Babylon.js directly.
 */

const BIOME_NAMES: Record<number, string> = {
  0: 'Ocean',
  1: 'Shallow Water',
  2: 'Beach',
  3: 'Grassland',
  4: 'Forest',
  5: 'Desert',
  6: 'Tundra',
  7: 'Snow',
  8: 'Mountain',
  9: 'Volcanic',
};

export class HUD {
  private _globeRoot:   HTMLElement;
  private _walkRoot:    HTMLElement;
  private _transition:  HTMLElement;
  private _fpsEl:       HTMLElement;
  private _altEl:       HTMLElement;
  private _coordsEl:    HTMLElement;
  private _biomeEl:     HTMLElement;
  private _lockPrompt:  HTMLElement;

  constructor() {
    this._globeRoot  = this._get('hud-globe');
    this._walkRoot   = this._get('hud-walk');
    this._transition = this._get('hud-transition');
    this._fpsEl      = this._get('hud-fps');
    this._altEl      = this._get('hud-alt-value');
    this._coordsEl   = this._get('hud-walk-coords');
    this._biomeEl    = this._get('hud-biome-label');
    this._lockPrompt = this._get('hud-lock-prompt');

    // Start hidden; shown after loading completes
    this._lockPrompt.classList.add('hidden');
  }

  private _get(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`HUD element #${id} not found`);
    return el;
  }

  // ── Callbacks ──────────────────────────────────────────────────────────

  onLandClicked(cb: () => void): void {
    this._get('btn-land').addEventListener('click', cb);
  }

  onExitClicked(cb: () => void): void {
    this._get('btn-exit-orbit').addEventListener('click', cb);
  }

  // ── Mode Switching ─────────────────────────────────────────────────────

  showGlobeMode(): void {
    this._walkRoot.classList.add('hidden');
    this._globeRoot.classList.remove('hidden');
    this._lockPrompt.classList.add('hidden');
  }

  showWalkMode(biomeId = 3): void {
    this._globeRoot.classList.add('hidden');
    this._walkRoot.classList.remove('hidden');
    this._biomeEl.textContent = BIOME_NAMES[biomeId] ?? 'Unknown';
    this._lockPrompt.classList.remove('hidden');
  }

  showLockPrompt(visible: boolean): void {
    if (visible) this._lockPrompt.classList.remove('hidden');
    else         this._lockPrompt.classList.add('hidden');
  }

  // ── Data Updates ───────────────────────────────────────────────────────

  updateFPS(fps: number): void {
    this._fpsEl.textContent = `${fps} FPS`;
  }

  updateAltitude(km: number): void {
    if (km < 1) {
      this._altEl.textContent = `${Math.round(km * 1000)} m`;
    } else {
      this._altEl.textContent = `${km.toFixed(1)} km`;
    }
  }

  updateWalkCoords(x: number, y: number, z: number): void {
    this._coordsEl.textContent =
      `x: ${x.toFixed(1)}  y: ${y.toFixed(1)}  z: ${z.toFixed(1)}`;
  }

  // ── Transition ─────────────────────────────────────────────────────────

  /**
   * Fades to black, calls onMidpoint (to switch scene), then fades back in.
   * Total duration: ~1 second.
   */
  transition(onMidpoint: () => void): Promise<void> {
    return new Promise(resolve => {
      this._transition.classList.add('fade-in');
      this._transition.classList.remove('fade-out');

      setTimeout(() => {
        onMidpoint();

        // Small delay to let the scene render one frame before fading in
        requestAnimationFrame(() => {
          this._transition.classList.remove('fade-in');
          this._transition.classList.add('fade-out');
          setTimeout(resolve, 520);
        });
      }, 520);
    });
  }

  // ── Loading Screen ─────────────────────────────────────────────────────

  setLoadingText(text: string): void {
    const el = document.getElementById('loading-sub');
    if (el) el.textContent = text;
  }

  setLoadingProgress(loaded: number, total: number): void {
    const fill = document.getElementById('loading-bar-fill');
    if (fill) fill.style.width = `${Math.round((loaded / total) * 100)}%`;
  }

  hideLoadingScreen(): void {
    const screen = document.getElementById('loading-screen');
    if (screen) {
      screen.classList.add('hidden');
      setTimeout(() => screen.remove(), 750);
    }
  }
}
