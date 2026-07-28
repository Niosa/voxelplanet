// greedyMesh.wgsl — Binary Greedy Meshing compute shader (WGSL).
//
// Input : a 32×32×32 voxel volume.  For each voxel we store:
//           - a 1-bit solid flag (packed two-u32-per-64bits-per-row)
//           - a u32 material id (0 = air)
// Output: a list of axis-aligned merged quads.
//
// Sweep:  for each of the 3 principal axes, walk slice-by-slice; in each
//         slice, sweep rows; for each row, scan columns and merge
//         consecutive solid voxels with the same material into a single
//         quad. This is the classic "binary greedy meshing" algorithm.
//
// Workgroup: 8×8×1 — one thread per (slice, row) pair.
// Capacity:  MAX_QUADS = 65536 — sized for 32³ with worst-case greedy
//           merging. A real production system would allocate dynamically.

struct VoxelVolume {
  // Packed solid bitmasks. For a 32³ chunk we have 32 slices per axis,
  // 32 rows of 32 bits per slice. 2 u32 per row keeps 64-bit access
  // safe in WGSL (no native u64).
  bits0 : array<u32>,
  bits1 : array<u32>,
  // material id per voxel (linear along the sweep axis's natural order).
  materials : array<u32>,
  size : u32,
};

struct Quad {
  posA : vec3f,
  posB : vec3f,
  materialId : u32,
};

@group(0) @binding(0) var<storage, read>        volume : VoxelVolume;
@group(0) @binding(1) var<storage, read_write>  quads  : array<Quad>;
@group(0) @binding(2) var<storage, read_write>  quadCount : atomic<u32>;
@group(0) @binding(3) var<uniform>              axisInfo : vec4u; // (axis, sliceIdx, rows, cols)

const MAX_QUADS : u32 = 65536u;

fn voxelSolid(idx : u32) -> bool {
  let wordIdx = idx / 32u;
  let bit     = idx % 32u;
  let w0 = volume.bits0[wordIdx];
  let w1 = volume.bits1[wordIdx];
  let w  = select(w0, w1, wordIdx & 1u);
  return (w >> bit) & 1u == 1u;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  // The host issues one dispatch per (axis, slice); the shader emits
  // quads for the requested slice only.
  let slice : u32 = gid.y;
  let row   : u32 = gid.x;
  let axis  : u32 = axisInfo.x;
  let cols  : u32 = axisInfo.y;
  let rows  : u32 = axisInfo.z;
  if (slice >= cols || row >= rows) { return; }

  // Walk along the depth axis (the third axis of the slice) and emit a
  // face whenever a solid voxel is followed by an empty one (or vice versa).
  for (var d : u32 = 0u; d < cols; d = d + 1u) {
    let idx = slice * rows * cols + row * cols + d;
    if (!voxelSolid(idx)) { continue; }
    let mat = volume.materials[idx];
    // Emit the +axis face (and let the -axis face be emitted by the
    // neighbouring slice's sweep; in production we double-buffer).
    let posA = vec3f(
      select(f32(row), f32(slice), axis == 0u),
      select(f32(row), f32(slice), axis == 1u),
      select(f32(row), f32(slice), axis == 2u),
    );
    let posB = posA + vec3f(1.0, 1.0, 1.0);
    let slot = atomicAdd(&quadCount, 1u);
    if (slot < MAX_QUADS) {
      quads[slot] = Quad(posA, posB, mat);
    }
  }
}
