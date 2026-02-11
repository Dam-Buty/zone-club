# Asset Pipeline - glTF, Compression, Textures

## GLB Draco Compression

Massive savings on mesh data (typically 80-97%):

```bash
# Install
npm install -g @gltf-transform/cli

# Compress with Draco
gltf-transform optimize input.glb output.glb --compress draco
```

Example: 24MB → 993KB

### R3F Usage

```typescript
// The 2nd parameter `true` enables Draco decoder via drei CDN
const { scene } = useGLTF('/models/model.glb', true);
useGLTF.preload('/models/model.glb', true);
```

---

## Image Compression

### Resize + JPEG Quality (macOS)
```bash
# Resize to max 2048px and set quality 70
sips -Z 2048 image.jpeg && sips -s formatOptions 70 image.jpeg

# Normal maps: quality 75 (no visible difference)
sips -s formatOptions 75 normal.jpg
```

### Resolution by Object Size

| Object Size | Max Resolution | Notes |
|-------------|---------------|-------|
| > 1m (full-screen poster) | 2048px | High detail needed |
| 10-50cm (cassette, book) | 512px | Overkill above this |
| < 10cm (miniature) | 256px | Barely visible |

---

## Font Stripping

Strip typeface.json to only needed characters:

```javascript
const font = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const neededChars = new Set('ABCDEFG'.split(''));
const stripped = { ...font, glyphs: {} };
for (const [char, glyph] of Object.entries(font.glyphs)) {
  if (neededChars.has(char)) stripped.glyphs[char] = glyph;
}
// 753 glyphs → 17 = 1367KB → 29KB (-97.9%)
```

---

## TMDB Texture Sizes

| 3D Object Size | TMDB Size | Anisotropy |
|---------------|-----------|------------|
| > 1m (poster) | w500 | 8-16 |
| 10-50cm (cassette, book) | **w200** | 4 |
| < 10cm (miniature) | w92 | 2 |

---

## DataArrayTexture

For 500+ unique textures on instanced geometry:

- Layer resolution: **200x300** (matches TMDB w200 source exactly)
- Memory: ~125MB for 520 layers
- M1 Metal supports **2048** array layers
- Y-flip pixels when copying (OpenGL UV convention: V=0 at bottom)

---

## Segment Counts by Object Size

| Object Size | cylinderGeometry | circleGeometry | sphereGeometry |
|-------------|-----------------|----------------|----------------|
| > 50cm | 12-16 | 16-24 | 16-32 |
| 10-50cm | 6-8 | 8-12 | 8-16 |
| < 10cm (buttons, eyes) | **4-6** | **6-8** | **6-8** |

---

## Shadow Map Size

**1024x1024** is sufficient for an indoor scene (was 2048x2048, -75% shadow pass cost).
