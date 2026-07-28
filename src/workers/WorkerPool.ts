/**
 * WorkerPool — round-robin dispatch with backpressure.
 *
 * Usage:
 *   const pool = new WorkerPool(() => new Worker(...), navigator.hardwareConcurrency - 1);
 *   pool.dispatch(message, transferables, onResponse);
 *   pool.dispose();
 */

export type WorkerFactory = () => Worker;

interface PendingTask {
  message: unknown;
  transferables: Transferable[];
  resolve: (response: unknown) => void;
  reject:  (err: unknown)      => void;
}

export class WorkerPool {
  private _workers: Worker[] = [];
  private _busy:    boolean[] = [];
  private _queue:   PendingTask[] = [];

  constructor(factory: WorkerFactory, workerCount: number) {
    const count = Math.max(1, workerCount);
    for (let i = 0; i < count; i++) {
      const w = factory();
      const idx = i;
      w.onmessage = (e) => this._handleResponse(idx, e.data as unknown);
      w.onerror   = (e) => this._handleError(idx, e);
      this._workers.push(w);
      this._busy.push(false);
    }
  }

  get workerCount(): number { return this._workers.length; }
  get queueDepth():  number { return this._queue.length; }

  /**
   * Dispatch a task to the next available worker.
   * If all workers are busy, the task is queued.
   * Returns a Promise that resolves with the worker's response message.
   */
  dispatch(
    message: unknown,
    transferables: Transferable[] = []
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const task: PendingTask = { message, transferables, resolve, reject };
      const idleIdx = this._busy.indexOf(false);
      if (idleIdx === -1) {
        this._queue.push(task);
      } else {
        this._send(idleIdx, task);
      }
    });
  }

  private _send(workerIdx: number, task: PendingTask): void {
    this._busy[workerIdx] = true;
    // Store resolve/reject on the worker for retrieval in _handleResponse
    (this._workers[workerIdx] as unknown as Record<string, unknown>)['__pending'] = task;
    this._workers[workerIdx]!.postMessage(task.message, task.transferables);
  }

  private _handleResponse(workerIdx: number, data: unknown): void {
    const task = (this._workers[workerIdx] as unknown as Record<string, unknown>)['__pending'] as PendingTask | undefined;
    if (task) task.resolve(data);
    this._busy[workerIdx] = false;
    this._drainQueue(workerIdx);
  }

  private _handleError(workerIdx: number, e: ErrorEvent): void {
    const task = (this._workers[workerIdx] as unknown as Record<string, unknown>)['__pending'] as PendingTask | undefined;
    if (task) task.reject(new Error(e.message));
    this._busy[workerIdx] = false;
    this._drainQueue(workerIdx);
  }

  private _drainQueue(workerIdx: number): void {
    if (this._queue.length > 0) {
      const next = this._queue.shift()!;
      this._send(workerIdx, next);
    }
  }

  dispose(): void {
    for (const w of this._workers) w.terminate();
    this._workers = [];
    this._busy    = [];
    this._queue   = [];
  }
}
