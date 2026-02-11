---
name: webgpu-canvas-text
description: "Skill for rendering text in WebGPU/Three.js WebGPU scenes using CanvasTexture. Use when implementing 3D text, neon signs, labels, UI text in WebGPU or Three.js WebGPU projects. IMPORTANT: Troika-three-text and @react-three/drei Text components are NOT compatible with WebGPU - always use this CanvasTexture technique instead."
---

# WebGPU Canvas Text Rendering

## CRITICAL: Why This Technique is Required

**Problem**: The standard text solutions for Three.js/R3F do NOT work with WebGPU:
- `@react-three/drei` Text component uses Troika-three-text internally
- Troika uses **GLSL** shaders that are incompatible with WebGPU's **WGSL** pipeline
- Result: Text simply does not render (invisible or crashes)

**Source**: https://discourse.threejs.org/t/troika-three-text-and-webgpu/55737

## The Rule

**Always use Canvas2D to render text, then convert to `THREE.CanvasTexture`.**

This works because CanvasTexture is just pixel data uploaded to the GPU -- no shader compilation involved.

## Core Function Signature

```typescript
function createTextTexture(
  text: string,
  options?: {
    fontSize?: number       // default 32
    fontFamily?: string     // default 'Arial, sans-serif'
    color?: string          // default '#ffffff'
    backgroundColor?: string // default 'transparent'
    width?: number          // default 256
    height?: number         // default 64
    glowColor?: string      // for neon effect
    align?: CanvasTextAlign  // default 'center'
  }
): THREE.CanvasTexture
```

Full implementation with multiline support, glow passes, and auto-sizing variant: see references.

## Quick R3F Usage

```tsx
function TextLabel({ text, position }) {
  const texture = useMemo(() => createTextTexture(text, {
    fontSize: 32, color: '#ffffff', width: 256, height: 64,
  }), [text])

  useEffect(() => () => texture.dispose(), [texture])

  return (
    <mesh position={position}>
      <planeGeometry args={[2, 0.5]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} />
    </mesh>
  )
}
```

Key props: `transparent` (alpha from canvas), `toneMapped={false}` (preserves emissive/neon colors).

## References

- [Full implementation + components](references/CANVAS_TEXTURE_TEXT_REFERENCE.md) -- createTextTexture, NeonSign, auto-sizing, dynamic text, neon colors
- [Troubleshooting + best practices](references/TROUBLESHOOTING.md) -- DO/DON'T lists, common errors table
