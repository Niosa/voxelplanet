/**
 * CellularAutomata — 2D CA for urban density generation within city Voronoi cells.
 *
 * Simulates city growth patterns:
 *   - Seeds: random high-density "downtown" pixels.
 *   - Spread rule: a cell activates if ≥ K of its 8 neighbours are active (life-like).
 *   - Decay rule: isolated cells die after D generations.
 *   - Output: per-pixel urban density float (0=wilderness, 1=dense urban core).
 *
 * Pure function — no DOM/Babylon dependencies. Web Worker safe.
 */

export interface CAOptions {
  seed: number;
  /** Width and height of the CA grid */
  width: number;
  height: number;
  /** Number of CA iterations */
  iterations?: number;
  /** Fraction of pixels to seed as urban core (0..1) */
  seedDensity?: number;
  /** Neighbour activation threshold (1..8) */
  activationThreshold?: number;
}

export interface CAResult {
  /** Per-pixel urban density (0..1) */
  density: Float32Array;
  width: number;
  height: number;
}

class LcgRng {
  private _s: number;
  constructor(seed: number) { this._s = seed >>> 0; }
  next(): number {
    this._s = (Math.imul(1664525, this._s) + 1013904223) >>> 0;
    return this._s / 0x100000000;
  }
}

export function runCellularAutomata(opts: CAOptions): CAResult {
  const {
    seed, width: W, height: H,
    iterations        = 8,
    seedDensity       = 0.12,
    activationThreshold = 4,
  } = opts;

  const rng = new LcgRng(seed);

  // Initialise grid with random seeds
  let grid = new Uint8Array(W * H);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = rng.next() < seedDensity ? 1 : 0;
  }

  const next = new Uint8Array(W * H);

  for (let iter = 0; iter < iterations; iter++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let neighbours = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
              neighbours += grid[ny * W + nx]!;
            }
          }
        }
        const idx = y * W + x;
        // Birth: empty cell with enough neighbours becomes active
        // Survival: active cell with enough neighbours stays active
        next[idx] = neighbours >= activationThreshold ? 1 : 0;
      }
    }
    grid.set(next);
  }

  // Smooth density: Gaussian blur approximation (box blur ×3)
  const density = new Float32Array(W * H);
  const floatGrid = new Float32Array(grid);

  // Pass the raw CA result through a simple box blur to get smooth density
  const blurred = boxBlur(floatGrid, W, H);
  const blurred2 = boxBlur(blurred, W, H);
  const blurred3 = boxBlur(blurred2, W, H);

  // Normalise to 0..1
  let maxVal = 0;
  for (let i = 0; i < blurred3.length; i++) {
    if (blurred3[i]! > maxVal) maxVal = blurred3[i]!;
  }
  if (maxVal > 0) {
    for (let i = 0; i < blurred3.length; i++) {
      density[i] = blurred3[i]! / maxVal;
    }
  }

  return { density, width: W, height: H };
}

function boxBlur(input: Float32Array, W: number, H: number): Float32Array {
  const output = new Float32Array(input.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
            sum += input[ny * W + nx]!;
            count++;
          }
        }
      }
      output[y * W + x] = sum / count;
    }
  }
  return output;
}
