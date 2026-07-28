/**
 * OrchestratorWorker — Layer 1 orchestrator.
 *
 * Runs in a dedicated Web Worker. Responsibilities:
 *   - Tracks the camera position (face + UV on the planet).
 *   - Maintains a priority queue of face generation tasks.
 *   - Dispatches tasks to a pool of ComputeWorkers (Layer 2).
 *   - Forwards completed geometry back to the main thread.
 *
 * Messages FROM main thread:
 *   { type: 'init', workerCount: number }
 *   { type: 'cameraUpdate', faceIndex: number, u: number, v: number, altitude: number }
 *   { type: 'requestFace', faceIndex: number, seed: number, resolution: number, planetRadius: number }
 *
 * Messages TO main thread:
 *   { type: 'faceReady', faceIndex, positions, normals, uvs, indices, biomeIds }
 *   { type: 'status', queueDepth, inFlight }
 */

import { WorkerPool } from './WorkerPool.ts';
import type { ComputeResponse } from './ComputeWorker.ts';

interface FaceRequest {
  faceIndex: number;
  seed: number;
  resolution: number;
  planetRadius: number;
  priority: number; // lower = higher priority
}

let pool: WorkerPool | null = null;
const pending = new Set<number>(); // face indices currently in-flight
const queue: FaceRequest[] = [];

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as Record<string, unknown>;

  switch (msg['type']) {
    case 'init': {
      const count = Math.max(1, (msg['workerCount'] as number) - 1);
      pool = new WorkerPool(
        () => new Worker(new URL('./ComputeWorker.ts', import.meta.url), { type: 'module' }),
        count
      );
      console.info(`[OrchestratorWorker] Pool ready with ${pool.workerCount} workers`);
      break;
    }

    case 'requestFace': {
      const req: FaceRequest = {
        faceIndex:   msg['faceIndex']   as number,
        seed:        msg['seed']        as number,
        resolution:  msg['resolution']  as number,
        planetRadius: msg['planetRadius'] as number,
        priority:    msg['priority'] as number ?? 0,
      };

      if (pending.has(req.faceIndex)) break; // already generating

      // Insert into priority queue (sorted ascending by priority)
      const insertAt = queue.findIndex(q => q.priority > req.priority);
      if (insertAt === -1) queue.push(req);
      else queue.splice(insertAt, 0, req);

      drainQueue();
      break;
    }

    case 'cameraUpdate': {
      // Re-sort queue based on camera proximity (future enhancement)
      // For now, priority is set by caller
      break;
    }
  }
};

function drainQueue(): void {
  if (!pool) return;
  while (queue.length > 0 && pool.queueDepth < pool.workerCount * 2) {
    const req = queue.shift()!;
    pending.add(req.faceIndex);
    dispatchFace(req);
  }
}

async function dispatchFace(req: FaceRequest): Promise<void> {
  if (!pool) return;

  const taskId = `face_${req.faceIndex}`;

  try {
    // Step 1: Generate heightmap + biomes
    const hmResult = await pool.dispatch(
      { taskId: `${taskId}_hm`, type: 'heightmap', opts: {
        seed: req.seed,
        resolution: req.resolution,
        faceIndex: req.faceIndex,
      }},
      []
    ) as ComputeResponse & { type: 'heightmap' };

    // Step 2: Generate cube face geometry using the heightmap
    const faceResult = await pool.dispatch(
      { taskId: `${taskId}_geo`, type: 'cubeFace', opts: {
        faceIndex: req.faceIndex as 0|1|2|3|4|5,
        resolution: req.resolution,
        planetRadius: req.planetRadius,
        heightmap: hmResult.heights,
        biomeIds: hmResult.biomeIds,
      }},
      [hmResult.heights.buffer, hmResult.biomeIds.buffer]
    ) as ComputeResponse & { type: 'cubeFace' };

    // Forward to main thread (transfer buffers)
    self.postMessage(
      {
        type: 'faceReady',
        faceIndex:   faceResult.faceIndex,
        positions:   faceResult.positions,
        normals:     faceResult.normals,
        uvs:         faceResult.uvs,
        indices:     faceResult.indices,
        biomeIds:    faceResult.biomeIds,
      },
      [
        faceResult.positions.buffer,
        faceResult.normals.buffer,
        faceResult.uvs.buffer,
        faceResult.indices.buffer,
        faceResult.biomeIds.buffer,
      ] as unknown as Transferable[]
    );
  } catch (err) {
    console.error(`[OrchestratorWorker] Face ${req.faceIndex} failed:`, err);
  } finally {
    pending.delete(req.faceIndex);
    drainQueue();
  }
}
