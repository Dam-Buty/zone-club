# Anti-Patterns & Lessons Learned

## Common Pitfalls

| Anti-Pattern | Consequence | Fix |
|-------------|-------------|-----|
| Forgetting `device.queue.submit()` | Nothing renders | Always submit commands at end of frame |
| Double tone mapping | Overexposed, washed out | One tone mapping in the entire pipeline |
| Double gamma correction | Colors too bright/flat | Verify gamma applied only once |
| Buffer offset misalignment | GPU validation error | Respect 256-byte alignment for uniforms |
| Binding group mismatch | Shader errors or wrong data | Layouts must match shader `@group/@binding` |
| Pipeline recreated each frame | CPU bottleneck, GC pressure | Cache and reuse pipelines |

---

## Lesson Learned: Geometry Laziness (01/02/2026)

**Context**: Video-club-webgpu project needed neon tube geometry.

**What happened**: Used simple boxes (`BoxGeometry`) instead of proper tubular geometry, despite `NeonTube.ts` existing in the codebase.

**Result**: Hours of work wasted. Render quality was "2005 video game" instead of the requested photorealism.

**Rule**: NEVER use simple placeholder geometry when proper geometry exists or can be created. Always check the codebase for existing implementations first.

---

## Diagnostic: "Rendu Noir" (Black Render)

Systematic checklist when the screen is completely black:

### Level 1: Pipeline
- [ ] `device.queue.submit()` is called
- [ ] Command encoder is `finish()`ed
- [ ] Render pass `end()` is called
- [ ] Clear color is not `{0,0,0,1}` (use a visible color temporarily)

### Level 2: Shaders
- [ ] Fragment shader returns a visible color (test with `return vec4f(1,0,0,1)`)
- [ ] Vertex shader outputs correct positions (are they in clip space?)
- [ ] Bind groups match shader declarations

### Level 3: Geometry
- [ ] Vertex buffer has data
- [ ] Index buffer (if used) has valid indices
- [ ] `drawIndexed(count)` count matches actual index count
- [ ] Vertices are within camera frustum

### Level 4: Post-Processing
- [ ] Post-processing reads from correct texture
- [ ] Tone mapping doesn't map everything to 0 (check exposure)
- [ ] Output format matches canvas format

---

## Golden Rules

1. **Never pretend a task is completed without visual verification**
2. **Never generate "plausible-looking" code without understanding the goal**
3. **Admit when you don't know** -- propose alternatives with a confidence index
4. **Study reference images pixel by pixel** before writing any code
5. **Break complex tasks into verifiable sub-tasks** -- each must be visually testable
