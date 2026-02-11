# Skill: Realistic Vehicle Light Reflections on Glass (GLSL/Three.js)

## Summary

Technique pour créer des reflets réalistes de phares de véhicules sur une vitrine en utilisant des shaders GLSL avec Three.js.

---

## Principe Fondamental

**ERREUR COURANTE**: Créer une illumination diffuse qui "éclaire" toute la surface.

**APPROCHE CORRECTE**: Le reflet est un **POINT lumineux** avec un halo gaussien, pas une bande ou une diffusion.

---

## Physique du Reflet sur Verre

1. **Source ponctuelle**: Le phare est un POINT lumineux
2. **Position du reflet**:
   - X = même position X que le véhicule
   - Y = position **FIXE** sur le verre (PAS dépendant de uv.y!)
3. **Forme**: Core brillant + halo gaussien
4. **Mouvement**: Le point se déplace horizontalement quand le véhicule passe
5. **Fresnel**: Plus de reflet aux angles rasants

---

## Code GLSL Clé

### Gaussian Glow (Core + Halo)

```glsl
float gaussianGlow(float dist, float coreSize, float falloff) {
  // Core brillant et net
  float core = exp(-dist * dist / (coreSize * coreSize));
  // Halo plus doux
  float halo = exp(-dist * dist / (falloff * falloff)) * 0.4;
  return core + halo;
}
```

### Position du Reflet (CRITIQUE)

```glsl
// FAUX - crée une bande verticale
vec2 reflectionPos = vec2(vehicleX, uv.y);  // NE JAMAIS FAIRE

// CORRECT - un seul point fixe sur le verre
float reflectionY = 0.55;  // Position Y fixe sur la vitre
vec2 reflectionPos = vec2(vehicleX, reflectionY);
```

### Application du Reflet

```glsl
// Pour chaque pixel de verre
if (glassMask > 0.1) {
  float dist = distance(uv, reflectionPos);
  float glow = gaussianGlow(dist, 0.015, 0.06);
  vec3 reflection = lightColor * glow * intensity;
  finalColor = screenBlend(finalColor, reflection);
}
```

### Screen Blend (Additive sans saturation)

```glsl
vec3 screenBlend(vec3 base, vec3 blend) {
  return 1.0 - (1.0 - base) * (1.0 - blend);
}
```

---

## Types de Véhicules

### Véhicule Standard (deux phares)

```glsl
float headlightSpacing = 0.03;
vec2 leftHeadlight = vec2(vehicleX - headlightSpacing, reflectionY);
vec2 rightHeadlight = vec2(vehicleX + headlightSpacing, reflectionY);

float glowLeft = gaussianGlow(distance(uv, leftHeadlight), 0.015, 0.06);
float glowRight = gaussianGlow(distance(uv, rightHeadlight), 0.015, 0.06);
```

### Police (Gyrophare bleu/rouge alternant)

```glsl
// Deux lumières séparées avec alternance
float flashPhase = fract(time * 3.5);
float blueFlash = smoothstep(0.0, 0.3, flashPhase) * smoothstep(0.5, 0.3, flashPhase);
float redFlash = smoothstep(0.5, 0.8, flashPhase) * smoothstep(1.0, 0.8, flashPhase);

vec3 blueColor = vec3(0.0, 0.3, 1.0);
vec3 redColor = vec3(1.0, 0.0, 0.0);

// Effet de rotation/balayage
float gyroEffect(vec2 uv, vec2 center, float time, float speed) {
  vec2 dir = uv - center;
  float angle = atan(dir.y, dir.x);
  float sweep = sin(angle * 2.0 + time * speed) * 0.5 + 0.5;
  return 0.5 + sweep * 0.5;
}
```

### Pompiers (Rouge intense avec flash)

```glsl
// Trois lumières avec phases décalées
float phase1 = step(0.5, fract(time * 4.0));
float phase2 = step(0.5, fract(time * 4.0 + 0.33));
float phase3 = step(0.5, fract(time * 4.0 + 0.66));

vec3 redColor = vec3(1.0, 0.0, 0.0);
vec3 orangeColor = vec3(1.0, 0.5, 0.0);
```

---

## Reflets sur Autres Surfaces

### Sol Mouillé (Streak vertical)

Le sol étant horizontal, le reflet s'étire **verticalement** (vers la caméra):

```glsl
// Streak: étroit en X, étiré en Y
float streakX = exp(-distX * distX / 0.003);  // Étroit
float streakY = exp(-distY * distY / 0.008);  // Étiré
float groundGlow = streakX * streakY;
```

### Métal (Reflet brossé)

```glsl
// Perturbation pour texture brossée
float brushNoise = noise(uv * vec2(150.0, 25.0)) * 0.008;
vec2 perturbedPos = reflectionPos + vec2(brushNoise, brushNoise);
```

---

## Erreurs à Éviter

| Erreur | Conséquence | Solution |
|--------|-------------|----------|
| `reflectionPos.y = uv.y` | Bande verticale | Y fixe: `reflectionY = 0.55` |
| Illumination diffuse | Effet "éclairé" sale | Point avec gaussianGlow |
| Pas de masque | Reflet partout | Vérifier `glassMask > 0.1` |
| Blend additif simple | Saturation | Utiliser screenBlend |

---

## Checklist d'Implémentation

- [ ] Position Y du reflet est **FIXE** (pas dépendant de uv.y)
- [ ] Utiliser gaussianGlow pour core + halo
- [ ] Screen blend pour l'addition
- [ ] Masque matériau vérifié avant application
- [ ] Deux points pour deux phares (véhicules standards)
- [ ] Effet gyroscope pour véhicules d'urgence
- [ ] Sol avec streak vertical (pas circulaire)

---

## Références

- [LearnOpenGL - Basic Lighting](https://learnopengl.com/Lighting/Basic-Lighting)
- [LearnOpenGL - Bloom](https://learnopengl.com/Advanced-Lighting/Bloom)
- [GLSL Specular Highlights](https://en.wikibooks.org/wiki/GLSL_Programming/GLUT/Specular_Highlights)
- [Glass Shader Techniques](https://alastaira.wordpress.com/2013/12/21/glass-shader/)

---

## Utilisation avec Three.js

```typescript
const material = new THREE.ShaderMaterial({
  uniforms: {
    uTexture: { value: storefrontTexture },
    uMask: { value: maskTexture },  // R=neon, G=glass, B=metal
    uTime: { value: 0 },
    uVehiclePosition: { value: 0.5 },
    uVehicleType: { value: 0 },  // 0=warm, 1=cool, 2=police, 3=fire
    uVehicleActive: { value: 0.0 },
  },
  vertexShader,
  fragmentShader,
});

// Animation loop
material.uniforms.uTime.value = elapsed;
material.uniforms.uVehiclePosition.value = vehicleX;
material.uniforms.uVehicleActive.value = fadeInOut;
```
