# Skill: Realistic Rain Simulation (Three.js)

## Summary

Technique pour créer une pluie réaliste avec physique et effet de bourrasque en utilisant Three.js avec un système de particules multi-couches.

---

## Principe Fondamental

**ERREUR COURANTE**: Utiliser un shader 2D ou des particules simples qui tombent uniformément.

**APPROCHE CORRECTE**: Système de particules 3D multi-couches avec simulation physique par goutte.

---

## Architecture du Système

### 1. Structure d'une goutte (RainDrop)

```typescript
interface RainDrop {
  x: number;
  y: number;
  z: number;
  velocity: number;      // Vitesse verticale
  velocityX: number;     // Vitesse horizontale (vent)
  length: number;        // Longueur de la traînée (motion blur)
  turbulence: number;    // Facteur aléatoire par goutte (0.5-1.5)
}
```

### 2. Structure d'une couche (RainLayer)

```typescript
interface RainLayer {
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial;
  lines: THREE.LineSegments;
  drops: RainDrop[];
  speedMin: number;
  speedMax: number;
}
```

---

## Multi-couches pour Effet de Profondeur

3 couches avec paramètres différents créent un effet de parallaxe réaliste:

| Couche | Gouttes | Taille | Vitesse | Opacité | Z (profondeur) |
|--------|---------|--------|---------|---------|----------------|
| **Avant** | 1300 | 0.04-0.064 | 0.027-0.042 | 0.245 | 0.6-0.85 |
| **Milieu** | 1000 | 0.024-0.04 | 0.018-0.027 | 0.175 | 0.35-0.55 |
| **Arrière** | 1000 | 0.012-0.02 | 0.012-0.02 | 0.105 | 0.1-0.3 |

**Règle**: Plus la couche est loin, plus les gouttes sont petites, lentes, et transparentes.

---

## Code: Création d'une Couche

```typescript
function createRainLayer(
  count: number,
  speedMin: number,
  speedMax: number,
  zMin: number,
  zMax: number,
  lengthMin: number,
  lengthMax: number,
  opacity: number
): RainLayer {
  const drops: RainDrop[] = [];
  const positions: number[] = [];

  for (let i = 0; i < count; i++) {
    const drop: RainDrop = {
      x: Math.random() * RAIN_AREA_X - RAIN_AREA_X / 2,
      y: Math.random() * RAIN_AREA_Y - RAIN_AREA_Y / 2,
      z: zMin + Math.random() * (zMax - zMin),
      velocity: speedMin + Math.random() * (speedMax - speedMin),
      velocityX: WIND_BASE,
      length: lengthMin + Math.random() * (lengthMax - lengthMin),
      turbulence: 0.5 + Math.random(),  // Chaque goutte réagit différemment
    };
    drops.push(drop);

    // LineSegments: 2 points par goutte (traînée)
    positions.push(drop.x, drop.y, drop.z);
    positions.push(drop.x - WIND_ANGLE_BASE * drop.length, drop.y + drop.length, drop.z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const material = new THREE.LineBasicMaterial({
    color: 0xaaccff,
    transparent: true,
    opacity: opacity,
    linewidth: 1,
  });

  const lines = new THREE.LineSegments(geometry, material);
  return { geometry, material, lines, drops, speedMin, speedMax };
}
```

---

## Vent Variable

### Paramètres de base

```typescript
const WIND_BASE = 0.0012;       // Vitesse de base du vent
const WIND_ANGLE_BASE = 0.06;   // Angle de base des traînées
```

### Variation organique (3 ondes sinusoïdales)

```typescript
function getWindVariation() {
  const variation1 = Math.sin(windTime * 0.5) * 0.3;   // Lente
  const variation2 = Math.sin(windTime * 1.3) * 0.15;  // Moyenne
  const variation3 = Math.sin(windTime * 2.7) * 0.05;  // Rapide subtile
  const totalVariation = variation1 + variation2 + variation3;

  return {
    speed: WIND_BASE * (1 + totalVariation * 0.5),
    angle: WIND_ANGLE_BASE * (1 + totalVariation * 0.3)
  };
}
```

---

## Système de Bourrasque (Gust)

### Paramètres

```typescript
const GUST_INTERVAL = 22;        // Cycle complet en secondes
const GUST_DURATION = 3;         // Durée de la bourrasque
const GUST_RECOVERY = 2;         // Temps de récupération après bourrasque
const GUST_STRENGTH = 0.002;     // Force de la bourrasque
const DRAG = 0.92;               // Résistance de l'air
const TURBULENCE_STRENGTH = 0.00075;  // Dispersion aléatoire
```

### Cycle complet

```
[0-17s] Pluie normale avec vent variable
[17-20s] Bourrasque (force du vent inversée, dispersion des gouttes)
[20-22s] Récupération (retour progressif à la normale)
```

### État du vent

```typescript
interface WindState {
  baseSpeed: number;
  baseAngle: number;
  gustActive: boolean;
  recovering: boolean;
  gustIntensity: number;
  gustForce: number;
  recoveryProgress: number;
}

function getWindState(): WindState {
  const cycleTime = windTime % GUST_INTERVAL;
  const gustActive = cycleTime < GUST_DURATION;
  const recovering = cycleTime >= GUST_DURATION && cycleTime < (GUST_DURATION + GUST_RECOVERY);

  if (gustActive) {
    const gustProgress = cycleTime / GUST_DURATION;
    // Courbe asymétrique: montée rapide (0.3s), déclin lent
    gustIntensity = gustProgress < 0.3
      ? gustProgress / 0.3
      : 1 - ((gustProgress - 0.3) / 0.7) * 0.7;
    gustForce = -GUST_STRENGTH * gustIntensity;  // Négatif = depuis la droite
  }
  // ...
}
```

---

## Simulation Physique par Goutte

```typescript
function updateRainLayer(layer: RainLayer): void {
  const wind = getWindState();

  for (const drop of layer.drops) {
    if (wind.gustActive) {
      // Turbulence aléatoire par goutte
      const turbulenceX = (Math.random() - 0.5) * TURBULENCE_STRENGTH * drop.turbulence * wind.gustIntensity;
      const turbulenceY = (Math.random() - 0.3) * TURBULENCE_STRENGTH * 0.5 * wind.gustIntensity;

      // Force appliquée selon facteur turbulence de la goutte
      drop.velocityX += wind.gustForce * drop.turbulence + turbulenceX;
      drop.velocity = Math.max(drop.velocity + turbulenceY, layer.speedMin * 0.5);

    } else if (wind.recovering) {
      // Retour très progressif
      const returnSpeed = 0.02 * wind.recoveryProgress;
      drop.velocityX += (wind.baseSpeed - drop.velocityX) * returnSpeed;
      // Turbulence résiduelle décroissante
      drop.velocityX += (Math.random() - 0.5) * (1 - wind.recoveryProgress) * 0.0003;

    } else {
      // Normal: retour doux
      drop.velocityX += (wind.baseSpeed - drop.velocityX) * 0.05;
    }

    // Résistance de l'air
    drop.velocityX *= DRAG;

    // Mouvement
    drop.y -= drop.velocity;
    drop.x += drop.velocityX;

    // Reset si hors limites
    if (drop.y < -RAIN_AREA_Y / 2 || Math.abs(drop.x) > RAIN_AREA_X / 2 + 0.5) {
      drop.y = RAIN_AREA_Y / 2 + Math.random() * 0.5;
      drop.x = Math.random() * RAIN_AREA_X - RAIN_AREA_X / 2;
      drop.velocityX = wind.baseSpeed;
      drop.turbulence = 0.5 + Math.random();
    }

    // Angle de traînée basé sur vélocité réelle
    const streakAngleX = drop.velocityX * 8;
    // Mise à jour positions BufferGeometry...
  }

  layer.geometry.attributes.position.needsUpdate = true;
}
```

---

## Setup Caméra pour Scène 2D+3D

```typescript
// Image de fond à z=0, pluie devant entre z=0.1 et z=0.85
this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3);
this.camera.position.z = 1;

// Image de fond
const mesh = new THREE.Mesh(geometry, material);
mesh.position.z = 0;

// Pluie ajoutée à la scène (z > 0, entre caméra et image)
for (const layer of rainLayers) {
  scene.add(layer.lines);
}
```

---

## Erreurs à Éviter

| Erreur | Conséquence | Solution |
|--------|-------------|----------|
| Gouttes identiques | Effet artificiel | `turbulence` aléatoire par goutte |
| Une seule couche | Pas de profondeur | 3 couches avec paramètres différents |
| Changement brusque de direction | Irréaliste | Période de récupération + drag |
| Shader 2D uniquement | Pas de parallaxe | LineSegments 3D avec z variable |
| Vent constant | Monotone | Variation sinusoïdale multi-fréquence |

---

## Checklist d'Implémentation

- [ ] 3 couches de pluie (avant, milieu, arrière)
- [ ] Taille/vitesse/opacité décroissantes avec la distance
- [ ] `turbulence` aléatoire par goutte
- [ ] Vent variable (3 ondes sin combinées)
- [ ] Système de bourrasque avec:
  - [ ] Courbe asymétrique (montée rapide, déclin lent)
  - [ ] Dispersion turbulente
  - [ ] Période de récupération
- [ ] Drag (résistance de l'air)
- [ ] Angle de traînée basé sur vélocité réelle
- [ ] `needsUpdate = true` sur geometry.attributes.position

---

## Références

- [Red Stapler - Three.js Rain Tutorial](https://redstapler.co/three-js-realistic-rain-tutorial/)
- Three.js LineSegments + BufferGeometry (API moderne)
