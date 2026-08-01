/**
 * HUD — manages all DOM overlay elements.
 * The HUD is pure DOM; it never touches Babylon.js directly.
 *
 * Additions:
 *   - onReturnToPinClicked() callback for pin list items.
 *   - showPinReturnPrompt() — modal to return to a saved pin.
 *   - refreshPinList() — rebuilds the pin list in the globe-mode HUD.
 */

import type { WalkPin } from '../globe/WalkPinRegistry.ts';

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
  10: 'Village',
  11: 'Town',
  12: 'City',
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
  private _pinList:     HTMLElement;
  private _pinModal:    HTMLElement;

  private _returnToPinCb: ((pinId: string) => void) | null = null;

  constructor() {
    this._globeRoot  = this._get('hud-globe');
    this._walkRoot   = this._get('hud-walk');
    this._transition = this._get('hud-transition');
    this._fpsEl      = this._get('hud-fps');
    this._altEl      = this._get('hud-alt-value');
    this._coordsEl   = this._get('hud-walk-coords');
    this._biomeEl    = this._get('hud-biome-label');
    this._lockPrompt = this._get('hud-lock-prompt');
    this._pinList    = this._get('hud-pin-list');
    this._pinModal   = this._get('hud-pin-modal');

    this._lockPrompt.classList.add('hidden');
    this._pinModal.classList.add('hidden');

    // Pin modal close button
    const closeBtn = document.getElementById('hud-pin-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this._pinModal.classList.add('hidden'));

    // Pin modal return button
    const returnBtn = document.getElementById('hud-pin-modal-return');
    if (returnBtn) {
      returnBtn.addEventListener('click', () => {
        const pinId = returnBtn.dataset['pinId'] ?? '';
        if (pinId && this._returnToPinCb) this._returnToPinCb(pinId);
        this._pinModal.classList.add('hidden');
      });
    }
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

  onReturnToPinClicked(cb: (pinId: string) => void): void {
    this._returnToPinCb = cb;
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

  // ── Pin UI ─────────────────────────────────────────────────────────────

  refreshPinList(pins: WalkPin[]): void {
    this._pinList.innerHTML = '';
    if (pins.length === 0) {
      this._pinList.innerHTML = '<li class="pin-empty">No pins yet</li>';
      return;
    }
    for (const pin of pins) {
      const li = document.createElement('li');
      li.className = 'pin-item';
      li.innerHTML = `
        <span class="pin-label">${escHtml(pin.label)}</span>
        <span class="pin-biome">${BIOME_NAMES[pin.biomeId] ?? ''}</span>
        <button class="pin-return-btn" data-pin-id="${escHtml(pin.id)}">↩ Return</button>
      `;
      li.querySelector('.pin-return-btn')?.addEventListener('click', () => {
        if (this._returnToPinCb) this._returnToPinCb(pin.id);
      });
      this._pinList.appendChild(li);
    }
  }

  showPinReturnPrompt(pin: WalkPin): void {
    const nameEl   = document.getElementById('hud-pin-modal-name');
    const biomeEl  = document.getElementById('hud-pin-modal-biome');
    const returnBtn = document.getElementById('hud-pin-modal-return');
    if (nameEl)   nameEl.textContent  = pin.label;
    if (biomeEl)  biomeEl.textContent = BIOME_NAMES[pin.biomeId] ?? '';
    if (returnBtn) returnBtn.dataset['pinId'] = pin.id;
    this._pinModal.classList.remove('hidden');
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

  transition(onMidpoint: () => void): Promise<void> {
    return new Promise(resolve => {
      this._transition.classList.add('fade-in');
      this._transition.classList.remove('fade-out');

      setTimeout(() => {
        onMidpoint();
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

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
