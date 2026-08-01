/**
 * GlobeToolbar — DOM-only toolbar that floats above the globe canvas.
 *
 * Provides buttons for:
 *   - Generate Landmass
 *   - Generate Island
 *   - Generate Forest
 *   - Generate Desert
 *   - Generate Region (political boundary)
 *
 * Each tool emits a CustomEvent on window so the rest of the system
 * can respond without tight coupling.
 *
 * This is a UI scaffold — the actual procedural generation tools
 * (which call HeightmapGenerator with modified parameters) will be
 * wired up in a future step.  For now the events are emitted and
 * logged so the pipeline is ready to receive them.
 */

export type GlobeToolType = 'landmass' | 'island' | 'forest' | 'desert' | 'region' | null;

export interface GlobeToolEvent {
  tool: GlobeToolType;
  alpha: number; // globe camera alpha at time of activation
  beta:  number; // globe camera beta
}

export class GlobeToolbar {
  private _root: HTMLElement;
  private _activeTool: GlobeToolType = null;
  private _getCamera: () => { alpha: number; beta: number };

  constructor(getCamera: () => { alpha: number; beta: number }) {
    this._getCamera = getCamera;

    this._root = document.createElement('div');
    this._root.id = 'globe-toolbar';
    this._root.className = 'globe-toolbar';
    this._root.innerHTML = `
      <span class="toolbar-label">🌍 Terrain Tools</span>
      <button data-tool="landmass" title="Generate Landmass">🏔 Landmass</button>
      <button data-tool="island"   title="Generate Island">🏝 Island</button>
      <button data-tool="forest"   title="Generate Forest">🌲 Forest</button>
      <button data-tool="desert"   title="Generate Desert">🏜 Desert</button>
      <button data-tool="region"   title="Generate Region">🗺 Region</button>
    `;
    document.body.appendChild(this._root);

    this._root.addEventListener('click', (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('[data-tool]') as HTMLElement | null;
      if (!btn) return;
      const tool = btn.dataset['tool'] as GlobeToolType;
      this._activeTool = this._activeTool === tool ? null : tool;
      this._updateActiveState();
      const { alpha, beta } = this._getCamera();
      window.dispatchEvent(new CustomEvent<GlobeToolEvent>('globeTool', {
        detail: { tool: this._activeTool, alpha, beta }
      }));
    });
  }

  private _updateActiveState(): void {
    const btns = this._root.querySelectorAll<HTMLButtonElement>('[data-tool]');
    btns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset['tool'] === this._activeTool);
    });
  }

  show(): void  { this._root.style.display = ''; }
  hide(): void  { this._root.style.display = 'none'; }

  dispose(): void {
    this._root.remove();
  }
}
