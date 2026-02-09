# Troubleshooting - Canvas Text in WebGPU

## Best Practices (DO)

- **Always dispose textures** on component unmount via `useEffect` cleanup
- **Use `toneMapped={false}`** for emissive/glowing text materials
- **Use `THREE.SRGBColorSpace`** for correct color rendering
- **Use `useMemo`** to avoid recreating textures on every render
- **Calculate aspect ratio** from canvas dimensions for proper plane sizing
- **Set `transparent={true}`** on materials using canvas textures with alpha

---

## Common Errors (DON'T)

- **Don't use `@react-three/drei` Text** component with WebGPU -- it uses Troika internally
- **Don't use `troika-three-text`** directly -- GLSL shaders incompatible with WGSL
- **Don't create textures in `useFrame`** or render loops -- causes massive GC pressure
- **Don't forget multiline handling** -- split on `\n` and draw each line separately
- **Don't skip `needsUpdate = true`** after modifying the canvas for dynamic text

---

## Troubleshooting Table

| Problem | Solution |
|---------|----------|
| Text invisible | Check `transparent={true}` on material |
| Colors washed out | Add `toneMapped={false}` to material |
| Text pixelated | Increase canvas `width`/`height` and `fontSize` |
| Text too small | Adjust `<planeGeometry args={[w, h]} />` size |
| Memory leak | Add `texture.dispose()` in `useEffect` cleanup |
| Wrong orientation | Use `side={THREE.DoubleSide}` on material |
| Blurry on high-DPI | Use `canvas.width = width * devicePixelRatio` |
| Glow doesn't show | Increase `shadowBlur` and draw text multiple times |

---

## References

- [Three.js CanvasTexture](https://threejs.org/docs/#api/en/textures/CanvasTexture)
- [HTML5 Canvas Text API](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D)
- [Troika WebGPU Issue](https://discourse.threejs.org/t/troika-three-text-and-webgpu/55737)
