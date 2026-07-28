import {
  Scene,
  Mesh,
  VertexData,
  StandardMaterial,
  Texture,
  DynamicTexture,
  Color3,
} from '@babylonjs/core';

/**
 * BiomeMaterialAtlas — a single 256×16 DynamicTexture where each row
 * encodes the diffuse color for one biome enum value.
 *
 * At render time, the vertex shader samples the atlas row by biome ID
 * (passed as a vertex attribute or custom UV). Using a single texture
 * keeps all 6 cube-sphere faces rendering with one draw call per face.
 */

/** RGBA (0-255) color per biome index */
const BIOME_COLORS: ReadonlyArray<[number, number, number]> = [
  [  5,  40, 105],  // 0 Ocean          — deep blue
  [ 25,  90, 180],  // 1 ShallowWater   — mid blue
  [200, 185, 140],  // 2 Beach          — sandy tan
  [100, 160,  60],  // 3 Grassland      — green
  [ 55, 115,  40],  // 4 Forest         — dark green
  [210, 175,  90],  // 5 Desert         — ochre
  [175, 185, 160],  // 6 Tundra         — grey-green
  [230, 235, 245],  // 7 Snow           — near-white
  [130,  95,  70],  // 8 Mountain       — stone brown
  [ 80,  55,  40],  // 9 Volcanic       — dark rock
];

const ATLAS_WIDTH  = 256;
const ATLAS_HEIGHT = 16; // one row per biome (enough rows for future expansion)

export class BiomeMaterialAtlas {
  readonly texture: DynamicTexture;
  readonly material: StandardMaterial;

  constructor(scene: Scene) {
    // Create the atlas texture
    this.texture = new DynamicTexture(
      'biomeAtlas',
      { width: ATLAS_WIDTH, height: ATLAS_HEIGHT },
      scene,
      false // no mip-maps — we want exact biome color lookup, no blending
    );

    const ctx = this.texture.getContext();

    // Paint one solid-color row per biome
    BIOME_COLORS.forEach(([r, g, b], i) => {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, i, ATLAS_WIDTH, 1);
    });

    this.texture.update();
    this.texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;

    // Material that uses the atlas
    this.material = new StandardMaterial('biomeMat', scene);
    this.material.diffuseTexture = this.texture;
    this.material.specularColor  = new Color3(0.05, 0.05, 0.05);
    this.material.backFaceCulling = true;
  }

  /**
   * Returns the atlas V coordinate (0..1) for a given biome ID.
   * Each biome maps to the center of its pixel row.
   */
  static biomeV(biomeId: number): number {
    return (biomeId + 0.5) / ATLAS_HEIGHT;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}

/**
 * Builds a Babylon Mesh from cube-sphere face geometry data.
 * Remaps the V component of UVs to the biome atlas row.
 */
export function buildCubeFaceMesh(
  scene: Scene,
  material: StandardMaterial,
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  biomeIds: Uint8Array,
  indices: Uint32Array,
  faceIndex: number
): Mesh {
  // Remap UVs: U = face U (0..1), V = biome atlas row
  const remappedUVs = new Float32Array(uvs.length);
  const vertCount = uvs.length / 2;
  for (let i = 0; i < vertCount; i++) {
    remappedUVs[i * 2 + 0] = uvs[i * 2 + 0];               // U: face position
    remappedUVs[i * 2 + 1] = BiomeMaterialAtlas.biomeV(biomeIds[i]); // V: biome row
  }

  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals   = normals;
  vertexData.uvs       = remappedUVs;
  vertexData.indices   = indices;

  const mesh = new Mesh(`cubeFace_${faceIndex}`, scene);
  vertexData.applyToMesh(mesh, false); // false = not updatable (static geometry)
  mesh.material = material;

  return mesh;
}
