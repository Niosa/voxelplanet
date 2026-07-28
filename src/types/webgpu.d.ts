/**
 * Minimal WebGPU ambient declarations for the types used in GPUMesher.ts.
 *
 * This shim avoids a dependency on @webgpu/types while keeping the compiler
 * happy. It is picked up automatically because tsconfig.json includes "src".
 *
 * Only the symbols actually referenced in the codebase are declared here.
 * Expand as needed when new WebGPU APIs are used.
 */

declare const GPUBufferUsage: {
  readonly MAP_READ:   number; // 0x0001
  readonly MAP_WRITE:  number; // 0x0002
  readonly COPY_SRC:   number; // 0x0004
  readonly COPY_DST:   number; // 0x0008
  readonly INDEX:      number; // 0x0010
  readonly VERTEX:     number; // 0x0020
  readonly UNIFORM:    number; // 0x0040
  readonly STORAGE:    number; // 0x0080
  readonly INDIRECT:   number; // 0x0100
  readonly QUERY_RESOLVE: number; // 0x0200
};

declare const GPUMapMode: {
  readonly READ:  number; // 0x0001
  readonly WRITE: number; // 0x0002
};

// Minimal interface stubs so GPUDevice, GPUBuffer, etc. resolve as `unknown`
// sub-types rather than erroring. These are only used behind the WebGPU
// feature-detect guard (`if (!navigator.gpu) return`) so runtime safety
// is handled by the guard, not the types.
declare interface GPUDevice {
  createBuffer(descriptor: object): GPUBuffer;
  createBindGroup(descriptor: object): GPUBindGroup;
  createCommandEncoder(descriptor?: object): GPUCommandEncoder;
  createComputePipeline(descriptor: object): GPUComputePipeline;
  createShaderModule(descriptor: object): GPUShaderModule;
  queue: GPUQueue;
  destroy(): void;
}

declare interface GPUBuffer {
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
}

declare interface GPUBindGroup {}
declare interface GPUComputePipeline {
  getBindGroupLayout(index: number): GPUBindGroupLayout;
}
declare interface GPUBindGroupLayout {}
declare interface GPUShaderModule {}
declare interface GPUCommandEncoder {
  beginComputePass(descriptor?: object): GPUComputePassEncoder;
  copyBufferToBuffer(
    source: GPUBuffer, sourceOffset: number,
    destination: GPUBuffer, destinationOffset: number,
    size: number
  ): void;
  finish(descriptor?: object): GPUCommandBuffer;
}
declare interface GPUComputePassEncoder {
  setPipeline(pipeline: GPUComputePipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}
declare interface GPUCommandBuffer {}
declare interface GPUQueue {
  submit(commandBuffers: GPUCommandBuffer[]): void;
  writeBuffer(buffer: GPUBuffer, bufferOffset: number, data: BufferSource): void;
}
