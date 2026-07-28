import { describe, it, expect } from 'vitest';
import { generateHeightmap, Biome } from '../globe/HeightmapGenerator';
import { generateCubeFace } from '../globe/CubeSphere';
import { generateVoronoiRegions } from '../globe/VoronoiRegions';
import { runCellularAutomata } from '../globe/CellularAutomata';

// ── HeightmapGenerator ────────────────────────────────────────────────────
describe('generateHeightmap', () => {
  it('produces the correct number of samples', () => {
    const result = generateHeightmap({ seed: 1, resolution: 16, faceIndex: 0 });
    expect(result.heights.length).toBe(16 * 16);
    expect(result.biomeIds.length).toBe(16 * 16);
    expect(result.moistures.length).toBe(16 * 16);
    expect(result.temperatures.length).toBe(16 * 16);
  });

  it('is deterministic across calls', () => {
    const a = generateHeightmap({ seed: 42, resolution: 8, faceIndex: 2 });
    const b = generateHeightmap({ seed: 42, resolution: 8, faceIndex: 2 });
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.biomeIds)).toEqual(Array.from(b.biomeIds));
  });

  it('produces different results for different seeds', () => {
    const a = generateHeightmap({ seed: 1, resolution: 16, faceIndex: 0 });
    const b = generateHeightmap({ seed: 2, resolution: 16, faceIndex: 0 });
    expect(Array.from(a.heights)).not.toEqual(Array.from(b.heights));
  });

  it('biome IDs are valid enum values', () => {
    const result = generateHeightmap({ seed: 7, resolution: 16, faceIndex: 3 });
    const validBiomes = Object.values(Biome) as number[];
    for (const b of result.biomeIds) {
      expect(validBiomes).toContain(b);
    }
  });

  it('heights are non-negative', () => {
    const result = generateHeightmap({ seed: 5, resolution: 16, faceIndex: 1 });
    for (const h of result.heights) {
      expect(h).toBeGreaterThanOrEqual(0);
    }
  });

  it('temperatures are clamped to [0, 1]', () => {
    const result = generateHeightmap({ seed: 3, resolution: 16, faceIndex: 4 });
    for (const t of result.temperatures) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });
});

// ── CubeSphere ────────────────────────────────────────────────────────────
describe('generateCubeFace', () => {
  it('generates correct vertex count', () => {
    const N = 8;
    const result = generateCubeFace({
      faceIndex: 0, resolution: N, planetRadius: 6_371_000,
    });
    expect(result.positions.length).toBe((N + 1) * (N + 1) * 3);
    expect(result.normals.length).toBe((N + 1) * (N + 1) * 3);
    expect(result.uvs.length).toBe((N + 1) * (N + 1) * 2);
  });

  it('generates correct index count', () => {
    const N = 4;
    const result = generateCubeFace({
      faceIndex: 0, resolution: N, planetRadius: 6_371_000,
    });
    expect(result.indices.length).toBe(N * N * 6); // 2 triangles per quad, 3 indices each
  });

  it('normals are unit length', () => {
    const result = generateCubeFace({
      faceIndex: 2, resolution: 4, planetRadius: 100,
    });
    const n = result.normals;
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.sqrt(n[i]! ** 2 + n[i+1]! ** 2 + n[i+2]! ** 2);
      expect(len).toBeCloseTo(1, 4);
    }
  });

  it('vertices sit at approximately planetRadius when no heightmap', () => {
    const R = 5000;
    const result = generateCubeFace({ faceIndex: 0, resolution: 4, planetRadius: R });
    const p = result.positions;
    for (let i = 0; i < p.length; i += 3) {
      const dist = Math.sqrt(p[i]! ** 2 + p[i+1]! ** 2 + p[i+2]! ** 2);
      expect(dist).toBeCloseTo(R, 0);
    }
  });
});

// ── VoronoiRegions ────────────────────────────────────────────────────────
describe('generateVoronoiRegions', () => {
  it('produces seeds and a cell map', () => {
    const N = 16;
    const biomeIds = new Uint8Array(N * N).fill(2); // all grassland
    const result = generateVoronoiRegions({
      seed: 1, resolution: N, faceIndex: 0, biomeIds,
    });
    expect(result.seeds.length).toBeGreaterThan(0);
    expect(result.cellMap.length).toBe(N * N);
  });

  it('cell map references valid seed IDs', () => {
    const N = 16;
    const biomeIds = new Uint8Array(N * N).fill(3);
    const result = generateVoronoiRegions({ seed: 7, resolution: N, faceIndex: 1, biomeIds });
    const validIds = new Set(result.seeds.map(s => s.id));
    for (const id of result.cellMap) {
      expect(validIds.has(id)).toBe(true);
    }
  });
});

// ── CellularAutomata ──────────────────────────────────────────────────────
describe('runCellularAutomata', () => {
  it('produces correct output dimensions', () => {
    const result = runCellularAutomata({ seed: 1, width: 16, height: 16 });
    expect(result.density.length).toBe(16 * 16);
    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
  });

  it('density values are in [0, 1]', () => {
    const result = runCellularAutomata({ seed: 42, width: 32, height: 32 });
    for (const d of result.density) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    const a = runCellularAutomata({ seed: 99, width: 16, height: 16 });
    const b = runCellularAutomata({ seed: 99, width: 16, height: 16 });
    expect(Array.from(a.density)).toEqual(Array.from(b.density));
  });
});
