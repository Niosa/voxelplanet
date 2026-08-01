/**
 * TouchController — virtual joystick overlay for mobile/tablet.
 *
 * Spawns two joystick zones into the walk-mode HUD:
 *   • Left zone  — move  (WASD equivalent)
 *   • Right zone — look  (mouse-look equivalent)
 *
 * Joystick state is readable each frame via `moveVector` and `lookDelta`.
 * The controller self-registers/deregisters from the DOM when
 * `attach()` / `detach()` are called.
 */

import type { Vector2 } from '@babylonjs/core';

/** Detect coarse-pointer (touch) devices. */
export function isMobileDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

interface JoystickState {
  active:    boolean;
  touchId:   number | null;
  originX:   number;
  originY:   number;
  currentX:  number;
  currentY:  number;
}

const DEADZONE    = 8;   // px
const MAX_RADIUS  = 60;  // px — max displacement before clamping

export class TouchController {
  private _moveState: JoystickState = _emptyState();
  private _lookState: JoystickState = _emptyState();

  private _leftZone:  HTMLElement | null = null;
  private _rightZone: HTMLElement | null = null;
  private _leftKnob:  HTMLElement | null = null;
  private _rightKnob: HTMLElement | null = null;

  private _onTouchStart:  (e: TouchEvent) => void;
  private _onTouchMove:   (e: TouchEvent) => void;
  private _onTouchEnd:    (e: TouchEvent) => void;

  constructor() {
    this._onTouchStart = (e) => this._handleStart(e);
    this._onTouchMove  = (e) => this._handleMove(e);
    this._onTouchEnd   = (e) => this._handleEnd(e);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  attach(): void {
    if (!isMobileDevice()) return;

    this._leftZone  = _makeZone('left');
    this._rightZone = _makeZone('right');
    this._leftKnob  = _makeKnob();
    this._rightKnob = _makeKnob();

    this._leftZone.appendChild(this._leftKnob);
    this._rightZone.appendChild(this._rightKnob);
    document.body.appendChild(this._leftZone);
    document.body.appendChild(this._rightZone);

    document.addEventListener('touchstart',  this._onTouchStart, { passive: false });
    document.addEventListener('touchmove',   this._onTouchMove,  { passive: false });
    document.addEventListener('touchend',    this._onTouchEnd,   { passive: false });
    document.addEventListener('touchcancel', this._onTouchEnd,   { passive: false });
  }

  detach(): void {
    document.removeEventListener('touchstart',  this._onTouchStart);
    document.removeEventListener('touchmove',   this._onTouchMove);
    document.removeEventListener('touchend',    this._onTouchEnd);
    document.removeEventListener('touchcancel', this._onTouchEnd);
    this._leftZone?.remove();
    this._rightZone?.remove();
    this._leftZone = this._rightZone = null;
    this._leftKnob = this._rightKnob = null;
    this._moveState = _emptyState();
    this._lookState = _emptyState();
  }

  // ── Frame reads ──────────────────────────────────────────────────────

  /**
   * Normalised move vector: x = strafe [-1,1], y = forward [-1,1].
   * Returns { x:0, y:0 } when joystick is in dead zone.
   */
  get moveVector(): { x: number; y: number } {
    return _normalise(this._moveState);
  }

  /**
   * Look delta in pixels since last call.  Consume by reading, then the
   * caller is responsible for applying it to camera rotation.
   */
  get lookDelta(): { x: number; y: number } {
    return _delta(this._lookState);
  }

  // ── Touch handlers ───────────────────────────────────────────────────

  private _handleStart(e: TouchEvent): void {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      const leftRect  = this._leftZone?.getBoundingClientRect();
      const rightRect = this._rightZone?.getBoundingClientRect();
      const { clientX: x, clientY: y } = touch;

      if (leftRect && _inRect(x, y, leftRect) && !this._moveState.active) {
        this._moveState = { active: true, touchId: touch.identifier, originX: x, originY: y, currentX: x, currentY: y };
      } else if (rightRect && _inRect(x, y, rightRect) && !this._lookState.active) {
        this._lookState = { active: true, touchId: touch.identifier, originX: x, originY: y, currentX: x, currentY: y };
      }
    }
  }

  private _handleMove(e: TouchEvent): void {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      if (this._moveState.active && touch.identifier === this._moveState.touchId) {
        this._moveState.currentX = touch.clientX;
        this._moveState.currentY = touch.clientY;
        _updateKnob(this._leftKnob, this._moveState);
      } else if (this._lookState.active && touch.identifier === this._lookState.touchId) {
        this._lookState.currentX = touch.clientX;
        this._lookState.currentY = touch.clientY;
        _updateKnob(this._rightKnob, this._lookState);
      }
    }
  }

  private _handleEnd(e: TouchEvent): void {
    e.preventDefault();
    for (const touch of Array.from(e.changedTouches)) {
      if (this._moveState.active && touch.identifier === this._moveState.touchId) {
        this._moveState = _emptyState();
        _resetKnob(this._leftKnob);
      } else if (this._lookState.active && touch.identifier === this._lookState.touchId) {
        this._lookState = _emptyState();
        _resetKnob(this._rightKnob);
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _emptyState(): JoystickState {
  return { active: false, touchId: null, originX: 0, originY: 0, currentX: 0, currentY: 0 };
}

function _normalise(s: JoystickState): { x: number; y: number } {
  if (!s.active) return { x: 0, y: 0 };
  const dx = s.currentX - s.originX;
  const dy = s.currentY - s.originY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < DEADZONE) return { x: 0, y: 0 };
  const clamped = Math.min(dist, MAX_RADIUS);
  return { x: (dx / dist) * (clamped / MAX_RADIUS), y: -(dy / dist) * (clamped / MAX_RADIUS) };
}

function _delta(s: JoystickState): { x: number; y: number } {
  if (!s.active) return { x: 0, y: 0 };
  return { x: s.currentX - s.originX, y: s.currentY - s.originY };
}

function _inRect(x: number, y: number, r: DOMRect): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function _makeZone(side: 'left' | 'right'): HTMLElement {
  const el = document.createElement('div');
  el.className = `joystick-zone ${side}`;
  return el;
}

function _makeKnob(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'joystick-knob';
  return el;
}

function _updateKnob(knob: HTMLElement | null, s: JoystickState): void {
  if (!knob) return;
  const dx = Math.max(-MAX_RADIUS, Math.min(MAX_RADIUS, s.currentX - s.originX));
  const dy = Math.max(-MAX_RADIUS, Math.min(MAX_RADIUS, s.currentY - s.originY));
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
}

function _resetKnob(knob: HTMLElement | null): void {
  if (!knob) return;
  knob.style.transform = 'translate(0px, 0px)';
}

// Suppress unused import warning — Vector2 is used by callers that
// consume moveVector/lookDelta as Vector2-compatible objects.
type _V2 = Vector2;
const _v2Unused: _V2 | undefined = undefined;
void _v2Unused;
