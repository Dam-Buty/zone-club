# Session Recovery - 2026-01-30

## What Happened

An attempt was made to upgrade the WebGPU video club scene from Blinn-Phong to PBR (Physically Based Rendering). The implementation created many new files but the shaders had fundamental incompatibilities with WebGPU's strict "uniform control flow" requirements.

## Critical Issue

WebGPU/WGSL has strict rules: `textureSample()` and `textureSampleCompare()` cannot be called inside conditional branches that depend on previous texture samples. This is different from GLSL/OpenGL.

**Example of forbidden pattern:**
```wgsl
let depth = textureSample(depthTex, sampler, uv);
if (depth >= 1.0) {
    return backgroundColor;  // ERROR: control flow depends on texture sample
}
let color = textureSample(colorTex, sampler, uv);  // This is now "non-uniform"
```

## Files Created (PBR - NOT WORKING)

These files exist but cause GPU crashes when used:

- `src/webgpu/scenes/AisleScenePBR.ts` - PBR scene integration
- `src/webgpu/rendering/GBuffer.ts` - Deferred rendering G-Buffer
- `src/webgpu/rendering/ShadowPass.ts` - Shadow mapping
- `src/webgpu/rendering/SSAOPass.ts` - Ambient occlusion
- `src/webgpu/rendering/BloomPass.ts` - HDR bloom
- `src/webgpu/rendering/ToneMappingPass.ts` - Tone mapping
- `src/webgpu/rendering/FXAAPass.ts` - Anti-aliasing
- `src/webgpu/shaders/gbuffer.wgsl` - G-Buffer shader
- `src/webgpu/shaders/pbr-lighting.wgsl` - PBR lighting shader (HAS ERRORS)
- `src/webgpu/shaders/shadow.wgsl` - Shadow shader
- `src/webgpu/shaders/ssao.wgsl` - SSAO shader (HAS ERRORS)
- `src/webgpu/shaders/bloom.wgsl` - Bloom shader
- `src/webgpu/shaders/tonemapping.wgsl` - Tone mapping shader
- `src/webgpu/shaders/fxaa.wgsl` - FXAA shader (HAS ERRORS)
- `src/webgpu/objects/InstancedMeshGroup.ts` - GPU instancing
- `src/webgpu/objects/NeonTube.ts` - 3D neon geometry
- `src/webgpu/objects/Cassette.ts` - Detailed cassette geometry
- `src/webgpu/core/Material.ts` - PBR materials
- `src/webgpu/core/ProceduralGeometry.ts` - Procedural meshes
- `src/webgpu/core/TextureAtlas.ts` - Texture atlas

## Current State (WORKING)

`VideoClubScene.tsx` has been reverted to use the original `AisleScene` (Blinn-Phong):

```typescript
import { AisleScene } from './scenes/AisleScene';
// ...
sceneRef.current = new AisleScene(device, context, format);
```

## How to Restore if Interface is Broken

1. Close all browser tabs with the app
2. Kill any vite processes: `pkill -f vite`
3. Run: `npm run dev`
4. Open: http://localhost:5173/

## If You Want to Try PBR Again Later

The shaders need complete rewriting to use only `textureLoad()` instead of `textureSample()`, or restructure to use compute shaders. This is a significant architectural change.

To re-enable PBR (NOT RECOMMENDED until shaders are fixed):
```typescript
// In VideoClubScene.tsx
import { AisleScenePBR } from './scenes/AisleScenePBR';
sceneRef.current = new AisleScenePBR(device, context, format);
```

## tsconfig Changes Made

In `tsconfig.app.json`, these were changed (may want to revert):
- `noUnusedLocals`: true -> false
- `noUnusedParameters`: true -> false

## Git Status

Changes are NOT committed. To see what changed:
```bash
git diff
git status
```

To discard all changes and restore original:
```bash
git checkout .
```

## Session Transcript

Full conversation transcript is at:
`/Users/rusmirsadikovic/.claude/projects/-Users-rusmirsadikovic-projetsperso-video-club-webgpu/`
