/* eslint-disable @typescript-eslint/no-explicit-any */

declare module 'three/webgpu' {
    import * as THREE from 'three';
    export * from 'three';

    // WebGPU-specific classes
    export class WebGPURenderer {
        constructor(parameters?: any);
        compute(computeNode: any): void;
        [key: string]: any;
    }

    export interface WebGPURendererParameters {
        canvas?: HTMLCanvasElement;
        antialias?: boolean;
        alpha?: boolean;
        [key: string]: any;
    }

    export class MeshStandardNodeMaterial extends THREE.Material {
        constructor(parameters?: any);
        colorNode: any;
        positionNode: any;
        normalNode: any;
        emissiveNode: any;
        roughnessNode: any;
        metalnessNode: any;
        roughness: number;
        metalness: number;
        side: any;
        transparent: boolean;
        opacity: number;
        [key: string]: any;
    }

    export class MeshBasicNodeMaterial extends THREE.Material {
        constructor(parameters?: any);
        colorNode: any;
        [key: string]: any;
    }

    export class SpriteNodeMaterial extends THREE.Material {
        constructor(parameters?: any);
        colorNode: any;
        [key: string]: any;
    }

    export class PostProcessing {
        constructor(renderer: any);
        outputNode: any;
        render(): void;
        [key: string]: any;
    }

    export class RectAreaLightNode {
        constructor(light: any);
        static setLTC(lib: any): void;
        [key: string]: any;
    }

    export class StorageInstancedBufferAttribute extends THREE.InstancedBufferAttribute {
        constructor(array: any, itemSize: number);
    }
}

declare module 'three/tsl' {
    export const texture: any;
    export const bumpMap: any;
    export const uv: any;
    export const attribute: any;
    export const Fn: any;
    export const instanceIndex: any;
    export const deltaTime: any;
    export const instancedArray: any;
    export const uniform: any;
    export const float: any;
    export const vec2: any;
    export const vec3: any;
    export const vec4: any;
    export const color: any;
    export const mix: any;
    export const step: any;
    export const smoothstep: any;
    export const clamp: any;
    export const sin: any;
    export const cos: any;
    export const abs: any;
    export const max: any;
    export const min: any;
    export const pow: any;
    export const fract: any;
    export const floor: any;
    export const mod: any;
    export const length: any;
    export const normalize: any;
    export const dot: any;
    export const cross: any;
    export const reflect: any;
    export const time: any;
    export const cameraPosition: any;
    export const positionWorld: any;
    export const positionLocal: any;
    export const normalWorld: any;
    export const normalLocal: any;
    export const modelWorldMatrix: any;
    export const If: any;
    export const Loop: any;
    export const Break: any;
    export const assign: any;
    export const add: any;
    export const sub: any;
    export const mul: any;
    export const div: any;
    export const negate: any;
    export const lessThan: any;
    export const greaterThan: any;
    export const equal: any;
    export const and: any;
    export const or: any;
    export const not: any;
    export const select: any;
    export const storage: any;
    export const storageObject: any;
    export const timerLocal: any;
    export const hash: any;
    export const pass: any;
    export const mrt: any;
    export const output: any;
    export const normalView: any;
    export const viewportUV: any;
}

declare module 'three/addons/tsl/display/BloomNode.js' {
    export const bloom: any;
}

declare module 'three/addons/tsl/display/GTAONode.js' {
    export const ao: any;
}

declare module 'three/addons/tsl/display/FXAANode.js' {
    export const fxaa: any;
}

declare module 'three/addons/controls/PointerLockControls.js' {
    export class PointerLockControls {
        constructor(camera: any, domElement?: any);
        isLocked: boolean;
        connect(): void;
        disconnect(): void;
        dispose(): void;
        lock(): void;
        unlock(): void;
        getObject(): any;
        getDirection(v: any): any;
        moveForward(distance: number): void;
        moveRight(distance: number): void;
        addEventListener(type: string, listener: any): void;
        removeEventListener(type: string, listener: any): void;
    }
}

declare module 'three/addons/utils/BufferGeometryUtils.js' {
    import { BufferGeometry } from 'three';
    export function mergeGeometries(geometries: BufferGeometry[], useGroups?: boolean): BufferGeometry;
}

declare module 'three/addons/lights/RectAreaLightTexturesLib.js' {
    export class RectAreaLightTexturesLib {
        static init(): void;
    }
}

// WGSL shader modules (loaded as raw text via webpack asset/source)
declare module '*.wgsl' {
    const source: string;
    export default source;
}

// Fix TypeScript 5.x strict ArrayBuffer generics for WebGPU
// Float32Array<ArrayBufferLike> is not assignable to GPUAllowSharedBufferSource
// because SharedArrayBuffer lacks properties added in ES2024 (resizable, transfer, etc.)
interface GPUQueue {
    writeBuffer(
        buffer: GPUBuffer,
        bufferOffset: GPUSize64,
        data: ArrayBufferView<any> | ArrayBuffer, // eslint-disable-line @typescript-eslint/no-explicit-any
        dataOffset?: GPUSize64,
        size?: GPUSize64,
    ): undefined;
}
