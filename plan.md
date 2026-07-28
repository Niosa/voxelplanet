# VoxelPlanet — Agent Implementation Plan

> **Status as of 2026-07-27**
> Steps 1–5 are complete. This document instructs the agent to implement
> Steps 6–10 in order. Do **not** modify any existing file unless explicitly
> told to below.

---

## Completed Systems (DO NOT RE-IMPLEMENT)

| File(s) | Plan Step | Notes |
|---|---|---|
| `src/engine/WebGPUInit.ts` | 1, 2 | WebGPU + WebGL2 fallback; COOP/COEP warning |
| `src/engine/FloatingOrigin.ts` | 3 | Float64 world pos, per-frame re-anchor |
| `src/engine/Scene.ts` | 3 | ArcRotateCamera, sun + ambient lighting |
| `src/globe/CubeSphere.ts` | 4 | 6-face heightmap → sphere geometry |
| `src/globe/HeightmapGenerator.ts` | 4 | Multi-octave fBm noise, biome/moisture/temp |
| `src/globe/VoronoiRegions.ts` | 4 | Political boundary tessellation |
| `src/globe/CellularAutomata.ts` | 4 | Urban density logic |
| `src/globe/BiomeMaterialAtlas.ts` | 4 | Per-biome material atlas |
| `src/globe/GlobeRenderer.ts` | 4 | Worker→Babylon mesh bridge, 6-face loading |
| `src/workers/OrchestratorWorker.ts` | 5 | Layer 1 orchestrator, priority queue |
| `src/workers/ComputeWorker.ts` | 5 | Layer 2 compute worker |
| `src/workers/WorkerPool.ts` | 5 | Promise-based worker pool |
| `src/main.ts` | 1–5 | Boot sequence, loading screen |
| `vite.config.ts` | 2 | COOP/COEP headers for dev + preview |

---

## Step 6 — Micro Voxel System (SVDAG)

### Goal
Implement a Sparse Voxel Directed Acyclic Graph to store micro-scale voxel
chunk data. This is the **data foundation** for Steps 7, 8, and 9.

### Files to create

#### `src/voxel/SVDAGNode.ts`
- Define a `SVDAGNode` interface/class with:
  - `childMask: number` (8-bit bitmask — 1 = child exists at that octant)
  - `children: (SVDAGNode | number)[]` — internal node has child refs;
    leaf node stores a `voxelType: number` (material ID)
  - Static `EMPTY` sentinel node (all children absent)
- Implement a `canonicalize(node: SVDAGNode): SVDAGNode` function that:
  - Recursively hashes each node's subtree
  - Merges identical subtrees by returning a shared reference (deduplication)
  - Use a `Map<string, SVDAGNode>` as the intern pool keyed by structural hash

#### `src/voxel/SVDAGChunk.ts`
- Define `CHUNK_SIZE = 32` (32×32×32 voxels per chunk)
- `class SVDAGChunk`:
  - Constructor: `(chunkX: number, chunkY: number, chunkZ: number)`
  - Internal: root `SVDAGNode`, last-accessed timestamp (for LRU eviction)
  - `get(x, y, z): number` — traverse the DAG, return `voxelType` (0 = air)
  - `set(x, y, z, voxelType: number): void` — rebuild/update affected subtree,
    re-canonicalize after write
  - `isEmpty(): boolean` — true if root === `SVDAGNode.EMPTY`
  - `touch(): void` — update `lastAccessed = performance.now()`

#### `src/voxel/ChunkManager.ts`
- `class ChunkManager`:
  - `private _chunks = new Map<string, SVDAGChunk>()` — key: `"cx,cy,cz"`
  - `private _vramBudgetBytes = 256 * 1024 * 1024` (256 MB iOS Safari cap)
  - `getOrCreate(cx, cy, cz): SVDAGChunk`
  - `evictLRU(): void` — remove least-recently-used chunks until estimated
    memory usage drops below `_vramBudgetBytes * 0.8`
  - `estimateMemoryBytes(): number` — rough estimate based on node count
  - `applyDelta(delta: VoxelDelta): void` — see Step 10 for `VoxelDelta` type;
    calls `chunk.set(...)` for each entry in the delta

#### `src/voxel/LODTraversal.ts`
- Export `function traverseSVDAG(root: SVDAGNode, camera: Vector3, errorThreshold: number): SVDAGNode[]`
  - Walk the DAG depth-first; at each node compute screen-space error metric:
    `error = nodeSize / distance(nodeCenter, camera)`
  - If `error < errorThreshold` return the current node (stop descending)
  - Collect leaf nodes for meshing
- Export `LOD_LEVELS = [512, 256, 128, 64, 32]` (world-unit node sizes per level)

### Tests to add in `src/__tests__/svdag.test.ts`
- Verify `get`/`set` round-trip at multiple positions
- Verify two identical subtrees share the same reference after canonicalization
- Verify `evictLRU` reduces chunk count when over budget

---

## Step 7 — WebGPU Compute Shaders & Meshing

> **Prerequisite:** Step 6 complete.

### Goal
Move all mesh generation off the CPU. Send SVDAG leaf data to the GPU via
WebGPU compute shaders. Implement two meshing strategies:
- **Binary Greedy Meshing** for urban/blocky areas
- **Surface Nets** for organic terrain

### Files to create

#### `src/shaders/greedyMesh.wgsl`
Implement a WebGPU compute shader that:
- Receives a flat `array<u32>` voxel bitmask per axis-slice (64-bit packed into
  two `u32` per row for WGSL compatibility)
- Uses bitwise ops (`&`, `|`, `^`, bit-shifts) to sweep faces and merge
  coplanar quads (standard binary greedy meshing algorithm)
- Writes output quads into a `storage` buffer: `array<Quad>` where
  `Quad = { posA: vec3f, posB: vec3f, materialId: u32 }`
- Uses `@compute @workgroup_size(8, 8, 1)` — one thread per voxel slice row

#### `src/shaders/surfaceNets.wgsl`
Implement a WebGPU compute shader that:
- Receives an `array<f32>` density field (SDF values at each voxel corner)
- Step 1 (vertex placement): each thread computes the crossing point on its
  cell's edges and writes a vertex + normal to a `storage` buffer
- Step 2 (index stitching): uses `atomicAdd` on a `atomic<u32>` vertex counter
  to assign unique vertex indices without race conditions
- Step 3: writes face indices connecting adjacent cells

#### `src/voxel/GPUMesher.ts`
- `class GPUMesher`:
  - Constructor: receives a Babylon `WebGPUEngine`; creates two
    `ComputeShader` instances (one per `.wgsl` above)
  - `meshBlocky(chunk: SVDAGChunk): Promise<MeshBuffers>` — runs
    `greedyMesh.wgsl`, reads back result via staging buffer
  - `meshOrganic(chunk: SVDAGChunk): Promise<MeshBuffers>` — runs
    `surfaceNets.wgsl`, reads back result via staging buffer
  - `MeshBuffers = { positions: Float32Array, normals: Float32Array, indices: Uint32Array }`
  - **TDR mitigation**: subdivide workload across multiple frames using
    `requestAnimationFrame` micro-batching if estimated shader runtime
    (chunk count × nodes) exceeds a 1.5-second heuristic threshold

#### `src/voxel/MeshClassifier.ts`
- Export `function classifyChunk(chunk: SVDAGChunk): 'blocky' | 'organic'`
  - Sample the biome IDs of the chunk's surface voxels
  - Return `'blocky'` if > 60% are urban biome IDs (IDs 7–12 from
    `BiomeMaterialAtlas`); otherwise `'organic'`

### Modify `src/workers/ComputeWorker.ts`
- Add a new task type `'meshChunk'`:
  ```ts
  | { type: 'meshChunk'; opts: { chunkKey: string; voxelData: Uint8Array; strategy: 'blocky' | 'organic' } }
  ```
- The response transfers back `positions`, `normals`, `indices` buffers

### Tests to add in `src/__tests__/meshing.test.ts`
- Verify greedy meshing produces fewer quads than naive per-face output
- Verify surface nets produces a manifold mesh (every edge shared by ≤ 2 faces)

---

## Step 8 — Indirect Drawing Pipeline

> **Prerequisite:** Step 7 complete.

### Goal
Replace per-chunk `mesh.setVerticesData()` calls with a single GPU-resident
mega-buffer and one `multiDrawIndexedIndirect` call per frame.

### Files to create

#### `src/render/MegaBuffer.ts`
- `class MegaBuffer`:
  - Allocates one large `GPUBuffer` in VRAM (`VERTEX_BUDGET = 128 MB`,
    `INDEX_BUDGET = 64 MB`) at construction
  - `upload(chunkKey: string, buffers: MeshBuffers): ChunkSlot` — writes into
    the next free region via a free-list allocator; returns
    `ChunkSlot = { baseVertex: number, firstIndex: number, indexCount: number }`
  - `free(chunkKey: string): void` — returns the slot to the free list
  - Maintains `private _slots = new Map<string, ChunkSlot>()`

#### `src/shaders/frustumCull.wgsl`
Implement a WebGPU compute shader that:
- Receives:
  - `array<AABB>` — one axis-aligned bounding box per chunk slot
  - `mat4x4f` — view-projection matrix from the current frame
  - `array<DrawArgs>` (indirect args buffer, write-only `storage`)
  - `atomic<u32>` draw count
- For each AABB: test all 8 corners against the 6 frustum planes
- If visible: `atomicAdd` on draw count, write
  `{ indexCount, instanceCount=1, firstIndex, baseVertex, firstInstance }` into
  the indirect args buffer
- `@compute @workgroup_size(64)`

#### `src/render/IndirectRenderer.ts`
- `class IndirectRenderer`:
  - Constructor: receives `WebGPUEngine`, `MegaBuffer`; creates the
    `frustumCull.wgsl` compute shader and the `GPUBuffer` for indirect draw args
  - `registerChunk(key: string, aabb: AABB): void` — adds AABB to the cull list
  - `unregisterChunk(key: string): void`
  - `renderFrame(viewProjMatrix: Matrix): void`:
    1. Upload current view-projection matrix to a uniform buffer
    2. Dispatch `frustumCull.wgsl` (one thread per registered chunk)
    3. Issue `engine.executeWhenRenderingStateIsComputed(() => { ... })` to call
       the Babylon `multiDrawIndexedIndirect` equivalent via raw WebGPU
       `renderPassEncoder.drawIndexedIndirect()`
  - **CPU overhead**: the CPU must only update the VP matrix uniform — zero
    per-chunk CPU work per frame after initial registration

### Modify `src/globe/GlobeRenderer.ts`
- After all 6 faces are loaded, instantiate `MegaBuffer` and
  `IndirectRenderer`
- Upload each face's mesh buffers to `MegaBuffer`
- Replace per-face `Mesh` objects with `IndirectRenderer.registerChunk()`
- Call `indirectRenderer.renderFrame(camera.getViewProjectionMatrix())` in
  `scene.onBeforeRenderObservable`

### Tests to add in `src/__tests__/megabuffer.test.ts`
- Verify `upload` + `free` + re-`upload` reuses the freed slot (no leak)
- Verify AABB frustum test returns correct visible/invisible for known matrices

---

## Step 9 — Mobile Constraints & Touch Controls

> **Prerequisite:** Step 7 (TDR mitigation already seeded there).

### Files to create

#### `src/input/TouchController.ts`
- `class TouchController`:
  - Constructor: receives `Scene`, `HTMLCanvasElement`
  - Creates two virtual joystick overlays (left = move, right = look) using
    `div` elements absolutely positioned in the CSS; see `src/style.css` for
    existing HUD layer structure
  - Maps `pointermove` / `pointerdown` / `pointerup` events to:
    - `moveVector: Vector3` (normalised XZ direction)
    - `lookDelta: { dx: number, dy: number }`
  - `dispose(): void` — removes all event listeners

#### `src/input/BlockInteraction.ts`
- `class BlockInteraction`:
  - Constructor: receives `Scene`, `ChunkManager`
  - Implements touch tap → block break:
    1. On single tap: fire a ray from tap screen position through the scene
    2. Hierarchically test ray against chunk `AABB`s (broad phase)
    3. For the hit chunk, traverse SVDAG bounding boxes (narrow phase) to find
       the exact voxel — zero JS allocation during traversal (reuse a
       pre-allocated `Vector3` stack)
    4. Call `chunk.set(x, y, z, 0)` (voxel type 0 = air = break)
    5. Emit a `'blockBroken'` CustomEvent with `{ chunkKey, x, y, z }`
       for the networking layer (Step 10)
  - Implements touch hold → block place (mirror of above, sets voxel to
    `selectedVoxelType`)

#### `src/mobile/VRAMWatchdog.ts`
- `class VRAMWatchdog`:
  - Constructor: receives `ChunkManager`; starts a `setInterval` at 2000 ms
  - Each tick: call `chunkManager.estimateMemoryBytes()`
  - If usage > `240 MB` (below iOS 256 MB hard cap): call
    `chunkManager.evictLRU()` and log a warning
  - `dispose(): void` — clears the interval

### Modify `src/main.ts`
- After `createScene(engine)`, instantiate `TouchController`,
  `BlockInteraction`, and `VRAMWatchdog`
- Add them to a `disposables` array; call `.dispose()` on `engine.onDisposeObservable`

### CSS additions in `src/style.css`
- Add `.joystick-zone` (left/right, bottom-aligned, 160px × 160px circles,
  semi-transparent white, `touch-action: none`)
- Add `.joystick-knob` (60px circle, draggable indicator inside zone)

---

## Step 10 — Live Map Updates & Networking

> **Prerequisite:** Step 9 (block break/place events must exist).

### Files to create

#### `src/net/VoxelDelta.ts`
- Export:
  ```ts
  export interface VoxelDelta {
    chunkKey: string;         // "cx,cy,cz"
    changes: Array<{
      localX: number;         // 0–31
      localY: number;
      localZ: number;
      voxelType: number;      // 0 = air
    }>;
    timestamp: number;        // Date.now()
    playerId: string;
  }
  ```

#### `src/net/WebSocketClient.ts`
- `class WebSocketClient`:
  - Constructor: `(url: string)` — connects to the Cloudflare Durable Object
    WebSocket endpoint
  - `sendDelta(delta: VoxelDelta): void` — serialises with `JSON.stringify` and
    sends over the WebSocket
  - `onDelta: ((delta: VoxelDelta) => void) | null` — set by caller to receive
    incoming deltas from other players
  - Implements exponential-backoff reconnection (max 30 s) on close/error
  - `dispose(): void` — `ws.close()`

#### `src/net/DeltaApplicator.ts`
- `class DeltaApplicator`:
  - Constructor: receives `ChunkManager`, `MegaBuffer`, `IndirectRenderer`,
    `WebSocketClient`
  - Listens on `wsClient.onDelta` and:
    1. Calls `chunkManager.applyDelta(delta)`
    2. Re-meshes the affected chunk via `GPUMesher`
    3. Calls `megaBuffer.free(chunkKey)` then `megaBuffer.upload(chunkKey, newBuffers)`
    4. Updates `indirectRenderer.registerChunk(chunkKey, newAABB)`
  - Also listens for `'blockBroken'` CustomEvents from `BlockInteraction` and
    sends them via `wsClient.sendDelta()`

#### `server/durableObject.ts` (Cloudflare Worker)
- Create this file **outside** `src/` — it is a Cloudflare Worker, not bundled
  by Vite
- `export class VoxelRoom implements DurableObject`:
  - `sessions: Set<WebSocket>` — connected players
  - `storage: DurableObjectStorage` — Cloudflare KV-backed persistent storage
  - `fetch(request: Request)`: upgrade to WebSocket via
    `new WebSocketPair()`
  - On message: parse `VoxelDelta`, persist via
    `this.storage.put(delta.chunkKey, serialisedDelta)`, broadcast to all
    other sessions
- Add `wrangler.toml` at repo root with:
  ```toml
  name = "voxelplanet-room"
  main = "server/durableObject.ts"
  compatibility_date = "2025-01-01"

  [[durable_objects.bindings]]
  name = "VOXEL_ROOM"
  class_name = "VoxelRoom"

  [[migrations]]
  tag = "v1"
  new_classes = ["VoxelRoom"]
  ```

### Modify `src/main.ts`
- Instantiate `WebSocketClient` pointing to the deployed Worker URL (read from
  `import.meta.env.VITE_WS_URL`)
- Instantiate `DeltaApplicator` after `ChunkManager`, `MegaBuffer`,
  `IndirectRenderer` are ready

### Modify `src/globe/HeightmapGenerator.ts`
- Export a new function `applyDeltaToHeightmap(delta: VoxelDelta, heightmap: Float32Array, resolution: number): void`
  - For each change in the delta, if `voxelType === 0` lower the heightmap
    sample at `(localX, localZ)` by 1 unit
  - This ensures surface edits are visible from orbit on the macro globe
- Call this from `DeltaApplicator` after applying each delta

### Add `.env.example` at repo root
```
VITE_WS_URL=wss://voxelplanet-room.<your-subdomain>.workers.dev
```

---

## Implementation Order for the Agent

Execute these steps **sequentially**. Each step depends on the previous.

1. `src/voxel/SVDAGNode.ts`
2. `src/voxel/SVDAGChunk.ts`
3. `src/voxel/ChunkManager.ts`
4. `src/voxel/LODTraversal.ts`
5. `src/__tests__/svdag.test.ts`
6. `src/shaders/greedyMesh.wgsl`
7. `src/shaders/surfaceNets.wgsl`
8. `src/voxel/GPUMesher.ts`
9. `src/voxel/MeshClassifier.ts`
10. Update `src/workers/ComputeWorker.ts` (add `meshChunk` task)
11. `src/__tests__/meshing.test.ts`
12. `src/render/MegaBuffer.ts`
13. `src/shaders/frustumCull.wgsl`
14. `src/render/IndirectRenderer.ts`
15. Update `src/globe/GlobeRenderer.ts` (indirect rendering)
16. `src/__tests__/megabuffer.test.ts`
17. `src/input/TouchController.ts`
18. `src/input/BlockInteraction.ts`
19. `src/mobile/VRAMWatchdog.ts`
20. Update `src/main.ts` (touch + watchdog)
21. Update `src/style.css` (joystick zones)
22. `src/net/VoxelDelta.ts`
23. `src/net/WebSocketClient.ts`
24. `src/net/DeltaApplicator.ts`
25. `server/durableObject.ts`
26. `wrangler.toml`
27. `.env.example`
28. Update `src/globe/HeightmapGenerator.ts` (`applyDeltaToHeightmap`)
29. Update `src/main.ts` (networking wiring)

---

## Key Constraints to Enforce Throughout

- **No DOM or Babylon.js imports inside worker files** — workers may only
  import from `src/globe/`, `src/voxel/`, and `src/net/VoxelDelta.ts`
- **All GPU work runs on the main thread** — `GPUMesher` and `IndirectRenderer`
  must be instantiated in `main.ts` or `GlobeRenderer.ts`, not inside a worker
- **TDR budget**: any compute shader dispatch estimated to run > 1.5 s must be
  split into micro-batches yielded across frames via `requestAnimationFrame`
- **VRAM cap**: never hold more than 240 MB of SVDAG + mesh data simultaneously;
  `VRAMWatchdog` enforces this
- **Float64 world positions**: all absolute coordinates stored in `Float64Array`;
  cast to `Float32` only at the point of GPU upload via `FloatingOrigin.toRenderSpace()`
