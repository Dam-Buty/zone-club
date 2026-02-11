# WebGPU Post-Processing Guide - HDR, Bloom, Tone Mapping

## RÈGLES OBLIGATOIRES - PROJET 3D/WEBGPU

**AVANT de coder:** Étudier l'image de référence, rechercher l'état de l'art, vérifier visuellement après CHAQUE modification.

**INTERDIT:** Boîtes par paresse, suppositions, marquer "complété" sans vérification visuelle.

---

> **LESSON LEARNED (2026-02-01)**: Ne JAMAIS appliquer tone mapping + gamma deux fois!
> Si la scène fait déjà Reinhard + Gamma, le post-processing ne doit ajouter QUE bloom/vignette/grain.

## Références
- [LearnOpenGL - Bloom](https://learnopengl.com/Advanced-Lighting/Bloom)
- [LearnOpenGL - HDR](https://learnopengl.com/Advanced-Lighting/HDR)
- [Learn Wgpu - HDR Tutorial](https://sotrh.github.io/learn-wgpu/intermediate/tutorial13-hdr/)
- [Catlike Coding - Bloom](https://catlikecoding.com/unity/tutorials/advanced-rendering/bloom/)
- [Bruno Opsenica - Tone Mapping](https://bruop.github.io/tonemapping/)
- [Unity Post Processing - Bloom](https://docs.unity3d.com/Packages/com.unity.postprocessing@3.2/manual/Bloom.html)

---

## Concepts Clés

### HDR vs LDR
- **LDR (Low Dynamic Range)**: Valeurs de couleur entre 0 et 1
- **HDR (High Dynamic Range)**: Valeurs de couleur peuvent dépasser 1 (ex: 5, 10, 100+)
- Le tone mapping convertit HDR → LDR pour l'affichage

### Pourquoi HDR est important
> "Si vous faites du tone mapping sur une image qui a déjà une plage dynamique normale, le résultat sera juste délavé."
> — GameDev.net

Pour que le bloom fonctionne correctement:
- Les sources lumineuses (néons, lampes) doivent avoir des valeurs **> 1.0**
- Ratio lumière/ambiant devrait être **100:1** ou plus (comme dans le monde réel)

---

## Paramètres Bloom

### Threshold (Seuil)
| Scène | Valeur recommandée |
|-------|-------------------|
| HDR correcte | **1.0** (seuls les pixels > 1 bloom) |
| LDR ou HDR faible | **0.6 - 0.8** |

**Soft Threshold**: 0.5 (transition douce entre bloom/non-bloom)

### Intensity (Intensité)
| Usage | Valeur |
|-------|--------|
| Subtil/réaliste | **0.3 - 0.5** |
| Normal | **1.0** |
| Stylisé (synthwave/néon) | **1.0 - 2.0** |

### Blur Radius
- Plus le rayon est grand, plus le glow est diffus
- Valeurs typiques: 5-15 samples par direction
- Pour effet néon: rayon plus large

---

## Paramètres Exposure

### Formule de base
```
exposedColor = sceneColor * exposure
```

### Valeurs typiques
| Scène | Exposure |
|-------|----------|
| HDR avec lumières très brillantes (10-100+) | **0.5 - 2.0** |
| HDR modérée (valeurs 1-10) | **1.0 - 3.0** |
| LDR (valeurs 0-1) | **1.0** (pas de changement) |

### Important
> L'exposure doit être ajustée en fonction des valeurs de la scène.
> Si la scène output des couleurs 0-1, exposure=1.0.
> Si la scène output des couleurs 0-100, exposure=0.01-0.1.

---

## Tone Mapping ACES

### Implémentation WGSL
```wgsl
fn acesFilm(x: vec3f) -> vec3f {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return saturate((x * (a * x + b)) / (x * (c * x + d) + e));
}
```

### Caractéristiques
- Assombrit légèrement les tons moyens
- Pousse les couleurs très brillantes vers le blanc
- Augmente le contraste pour un look "cinématique"

---

## Paramètres VHS/Synthwave

### Grain
| Effet | Intensité |
|-------|-----------|
| Subtil | **0.01 - 0.02** |
| Visible | **0.03 - 0.05** |
| Fort (VHS usée) | **0.08 - 0.15** |

### Vignette
| Effet | Intensité |
|-------|-----------|
| Subtil | **0.1 - 0.2** |
| Modéré | **0.3 - 0.5** |
| Fort | **0.6 - 0.8** |

### Scanlines
- Fréquence: 400-800 lignes (dépend de la résolution)
- Intensité: 0.02-0.05 pour effet subtil

---

## Configuration Recommandée pour Vidéoclub Synthwave

### Si la scène utilise des valeurs HDR (néons = 5-50+)
```typescript
{
  bloomThreshold: 1.0,
  bloomIntensity: 0.8,
  vignetteIntensity: 0.3,
  grainIntensity: 0.015,
  exposure: 1.5,
}
```

### Si la scène utilise des valeurs LDR (couleurs 0-1)
```typescript
{
  bloomThreshold: 0.7,
  bloomIntensity: 0.4,
  vignetteIntensity: 0.3,
  grainIntensity: 0.015,
  exposure: 1.0,
}
```

---

## Debug / Diagnostic

### Scène trop sombre
- Augmenter `exposure`
- Vérifier que les couleurs de la scène ne sont pas trop faibles

### Scène trop claire / délavée
- Réduire `exposure`
- Vérifier que les couleurs de la scène ne sont pas trop élevées
- Le tone mapping ACES assombrit un peu - c'est normal

### Bloom invisible
- Réduire `bloomThreshold`
- Augmenter `bloomIntensity`
- Vérifier que des pixels dépassent le threshold après exposure

### Bloom trop fort / tout blanc
- Augmenter `bloomThreshold`
- Réduire `bloomIntensity`
- Réduire `exposure`

### Grain trop visible (neige)
- Réduire `grainIntensity` (< 0.01)
- S'assurer que l'exposure n'assombrit pas trop la scène (le grain devient visible sur fond sombre)

---

## Pipeline de Rendu Typique

1. **Render Scene** → HDR Texture (rgba16float)
2. **Bright Extract** → Extraire pixels > threshold
3. **Gaussian Blur** → Flouter les pixels brillants (2 passes: H + V)
4. **Composite** → Combiner scène + bloom
5. **Tone Map** → ACES pour convertir HDR → LDR
6. **Post Effects** → Vignette, grain, scanlines
7. **Output** → Canvas (bgra8unorm)

---

## Vérification des Valeurs de Scène

Pour débugger, afficher temporairement les couleurs brutes:
```wgsl
// Dans le fragment shader final
return vec4f(color, 1.0);  // Voir les couleurs avant tone mapping
```

Si les couleurs sont toutes < 1.0, la scène n'est pas vraiment HDR.
Pour un vrai HDR, les sources lumineuses doivent avoir des valeurs > 1.0.
