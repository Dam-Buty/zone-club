import * as THREE from 'three';

/**
 * EXTERIOR SCENE - VideoClub Storefront
 * =====================================
 * Uses a pre-generated mask texture for precise material mapping:
 * - Red channel: Neon areas (255=full, 200=O, 150=B, 100=Open24/7)
 * - Green channel: Glass areas (255=glass, 50=ground)
 * - Blue channel: Metal frame areas
 */

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D uTexture;
  uniform sampler2D uMask;
  uniform float uTime;
  uniform float uOIntensity;
  uniform float uBIntensity;

  // Vehicle uniforms
  uniform float uVehiclePosition;
  uniform float uVehicleType; // 0=3000K, 1=4000K, 2=police, 3=maintenance
  uniform float uVehicleActive;

  varying vec2 vUv;

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }


  // ============================================
  // VEHICLE LIGHT COLOR
  // ============================================

  // Returns the PRIMARY color for a vehicle type
  // For emergency vehicles, this is used for the main flash
  vec3 getVehicleLightColor(float vType, float time) {
    if (vType < 0.5) {
      return vec3(1.0, 0.82, 0.6); // 3000K warm headlights
    } else if (vType < 1.5) {
      return vec3(0.95, 0.98, 1.0); // 4000K cool headlights
    } else if (vType < 2.5) {
      // Police: alternating blue/red at ~3.5Hz
      float alternate = step(0.5, fract(time * 3.5));
      return mix(vec3(0.0, 0.3, 1.0), vec3(1.0, 0.0, 0.0), alternate);
    } else {
      // Fire truck: red with orange flash
      float flash = step(0.5, fract(time * 4.0));
      return mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 0.4, 0.0), flash);
    }
  }

  // Emergency vehicle gyroscope effect - creates rotating/sweeping pattern
  // Returns intensity multiplier based on angle from center
  float gyroEffect(vec2 uv, vec2 center, float time, float speed) {
    vec2 dir = uv - center;
    float angle = atan(dir.y, dir.x);
    float rotation = time * speed;
    // Create sweeping beam effect
    float sweep = sin(angle * 2.0 + rotation) * 0.5 + 0.5;
    return 0.5 + sweep * 0.5;
  }

  // ============================================
  // HEADLIGHT REFLECTION ON GLASS
  // ============================================
  //
  // Physics of headlight reflection on a storefront window:
  //
  // 1. The headlight is a POINT source at (vehicleX, groundLevel)
  // 2. The reflection appears as a SINGLE POINT on the glass surface
  // 3. This point has a bright core + gaussian halo (bloom)
  // 4. The point moves horizontally as the vehicle passes
  // 5. Fresnel effect: more reflection at grazing angles
  //
  // The reflection position on a vertical glass surface:
  // - Same X as the vehicle
  // - Y position is FIXED on the glass (around middle of window)
  // - NOT dependent on the current pixel's Y (that creates a vertical band)

  // Gaussian glow function - creates bright core with soft falloff
  float gaussianGlow(float dist, float coreSize, float falloff) {
    // Bright sharp core
    float core = exp(-dist * dist / (coreSize * coreSize)) ;
    // Softer halo
    float halo = exp(-dist * dist / (falloff * falloff)) * 0.4;
    return core + halo;
  }

  // Screen blend mode
  vec3 screenBlend(vec3 base, vec3 blend) {
    return 1.0 - (1.0 - base) * (1.0 - blend);
  }

  // ============================================
  // NEON EFFECT
  // ============================================

  vec3 applyNeonEffect(vec3 color, float maskValue, float time, float oIntensity, float bIntensity) {
    float effectStrength = smoothstep(0.01, 0.08, maskValue);
    if (effectStrength < 0.001) return color;

    float neonType = maskValue * 255.0;
    float intensity = 1.0;
    vec3 neonColor;

    if (neonType > 180.0) {
      if (neonType > 190.0 && neonType < 210.0) {
        intensity = oIntensity;
      }
      neonColor = vec3(0.68, 0.28, 0.98);
    } else if (neonType > 140.0) {
      intensity = bIntensity;
      neonColor = vec3(0.68, 0.28, 0.98);
    } else if (neonType > 80.0) {
      float flicker = 0.94 + sin(time * 11.0) * 0.03 + sin(time * 23.0) * 0.02;
      intensity = flicker;
      neonColor = vec3(0.98, 0.45, 0.72);
    } else {
      return color;
    }

    float flicker = 0.98 + noise(vec2(time * 12.0, 0.0)) * 0.02;
    intensity *= flicker;

    float glowIntensity = intensity * effectStrength * 0.35;
    vec3 glowColor = neonColor * glowIntensity;
    return screenBlend(color, glowColor);
  }

  // ============================================
  // MAIN
  // ============================================

  void main() {
    vec4 texColor = texture2D(uTexture, vUv);
    vec4 maskColor = texture2D(uMask, vUv);
    vec3 finalColor = texColor.rgb;

    // UV with Y flipped for image coordinates
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);

    // Extract mask channels
    float neonMask = maskColor.r;
    float glassMask = maskColor.g;
    float metalMask = maskColor.b;

    // Vehicle light properties
    vec3 vehicleColor = getVehicleLightColor(uVehicleType, uTime);
    float vehicleIntensity = uVehicleActive;
    float vType = uVehicleType;

    // ========== HEADLIGHT REFLECTIONS ON GLASS ==========
    //
    // Key insight: The reflection is a POINT, not a band.
    // Position: X follows the vehicle, Y is FIXED on the glass surface
    //
    // For a car passing by:
    // - Left headlight reflection at (vehicleX - offset, glassY)
    // - Right headlight reflection at (vehicleX + offset, glassY)
    //
    // The reflection only appears WHERE THE GLASS IS (mask check)

    if (glassMask > 0.1 && vehicleIntensity > 0.01) {
      float glassStrength = smoothstep(0.1, 0.5, glassMask);

      // FIXED Y position for the reflection point on the glass
      // The glass window is roughly between Y=0.20 and Y=0.85
      // The headlight reflection appears at around Y=0.55 (middle-ish of window)
      float reflectionY = 0.55;

      // Headlight spacing (two headlights per vehicle)
      float headlightSpacing = 0.03;

      // For regular vehicles: two headlights
      // For emergency: single wider light source
      vec3 totalReflection = vec3(0.0);

      if (vType < 1.5) {
        // Regular vehicle - two headlights
        vec2 leftHeadlight = vec2(uVehiclePosition - headlightSpacing, reflectionY);
        vec2 rightHeadlight = vec2(uVehiclePosition + headlightSpacing, reflectionY);

        float distLeft = distance(uv, leftHeadlight);
        float distRight = distance(uv, rightHeadlight);

        // Core size and halo falloff
        float coreSize = 0.015;
        float haloSize = 0.06;

        float glowLeft = gaussianGlow(distLeft, coreSize, haloSize);
        float glowRight = gaussianGlow(distRight, coreSize, haloSize);

        totalReflection = vehicleColor * (glowLeft + glowRight) * 0.8;
      } else if (vType < 2.5) {
        // ===== POLICE =====
        // Two separate light bars: BLUE left, RED right
        // They alternate in intensity (one flashes while other dims)
        float policeSpacing = 0.04;
        vec2 blueLight = vec2(uVehiclePosition - policeSpacing, reflectionY);
        vec2 redLight = vec2(uVehiclePosition + policeSpacing, reflectionY);

        float distBlue = distance(uv, blueLight);
        float distRed = distance(uv, redLight);

        // Alternating flash pattern (out of phase)
        float flashPhase = fract(uTime * 3.5);
        float blueFlash = smoothstep(0.0, 0.3, flashPhase) * smoothstep(0.5, 0.3, flashPhase);
        float redFlash = smoothstep(0.5, 0.8, flashPhase) * smoothstep(1.0, 0.8, flashPhase);

        // Larger glow for emergency lights
        float coreSize = 0.02;
        float haloSize = 0.12;

        float glowBlue = gaussianGlow(distBlue, coreSize, haloSize);
        float glowRed = gaussianGlow(distRed, coreSize, haloSize);

        // Apply gyro sweep effect
        float gyroBlue = gyroEffect(uv, blueLight, uTime, 8.0);
        float gyroRed = gyroEffect(uv, redLight, uTime, -8.0); // Opposite direction

        vec3 blueColor = vec3(0.0, 0.3, 1.0);
        vec3 redColor = vec3(1.0, 0.0, 0.0);

        vec3 blueReflection = blueColor * glowBlue * blueFlash * gyroBlue * 1.5;
        vec3 redReflection = redColor * glowRed * redFlash * gyroRed * 1.5;

        totalReflection = blueReflection + redReflection;

      } else {
        // ===== FIRE TRUCK (POMPIERS) =====
        // Intense red with rotating pattern + white strobe
        // Fire trucks have multiple red lights that rotate/flash
        float fireSpacing = 0.035;
        vec2 leftLight = vec2(uVehiclePosition - fireSpacing, reflectionY);
        vec2 centerLight = vec2(uVehiclePosition, reflectionY);
        vec2 rightLight = vec2(uVehiclePosition + fireSpacing, reflectionY);

        float distLeft = distance(uv, leftLight);
        float distCenter = distance(uv, centerLight);
        float distRight = distance(uv, rightLight);

        // Staggered flash pattern for multiple lights
        float phase1 = step(0.5, fract(uTime * 4.0));
        float phase2 = step(0.5, fract(uTime * 4.0 + 0.33));
        float phase3 = step(0.5, fract(uTime * 4.0 + 0.66));

        // Larger glow for fire truck lights
        float coreSize = 0.018;
        float haloSize = 0.10;

        float glowLeft = gaussianGlow(distLeft, coreSize, haloSize);
        float glowCenter = gaussianGlow(distCenter, coreSize * 1.2, haloSize * 1.3);
        float glowRight = gaussianGlow(distRight, coreSize, haloSize);

        // Gyro effect for rotating beacon feel
        float gyroCenter = gyroEffect(uv, centerLight, uTime, 10.0);

        // Colors: mainly red with occasional white/orange flash
        vec3 redColor = vec3(1.0, 0.0, 0.0);
        vec3 orangeColor = vec3(1.0, 0.5, 0.0);

        vec3 leftReflection = redColor * glowLeft * phase1 * 1.3;
        vec3 centerReflection = mix(redColor, orangeColor, phase2 * 0.5) * glowCenter * gyroCenter * 1.5;
        vec3 rightReflection = redColor * glowRight * phase3 * 1.3;

        totalReflection = leftReflection + centerReflection + rightReflection;
      }

      // Apply reflection intensity and glass mask
      totalReflection *= vehicleIntensity * glassStrength;

      // Additive blend
      finalColor = screenBlend(finalColor, totalReflection);
    }

    // ========== HEADLIGHT REFLECTIONS ON METAL FRAME ==========

    if (metalMask > 0.1 && vehicleIntensity > 0.01) {
      float metalStrength = smoothstep(0.1, 0.4, metalMask);

      // Reflection on metal - similar position but smaller, sharper
      float reflectionY = 0.55;
      vec2 reflectionPos = vec2(uVehiclePosition, reflectionY);

      // Add slight perturbation for brushed metal look
      float brushNoise = noise(uv * vec2(150.0, 25.0)) * 0.008;
      reflectionPos += vec2(brushNoise, brushNoise);

      float dist = distance(uv, reflectionPos);
      float glow = gaussianGlow(dist, 0.01, 0.04);

      vec3 metalReflection = vehicleColor * glow * 0.6 * vehicleIntensity * metalStrength;
      finalColor = screenBlend(finalColor, metalReflection);
    }

    // ========== HEADLIGHT REFLECTIONS ON WET GROUND ==========
    //
    // The ground shows an elongated vertical reflection (streak)
    // because the ground is horizontal and reflects differently

    if (uv.y > 0.86 && vehicleIntensity > 0.01) {
      float groundStrength = smoothstep(0.86, 0.98, uv.y);

      // Puddles make the ground more reflective
      float puddleNoise = noise(uv * vec2(12.0, 4.0));
      float puddle = smoothstep(0.3, 0.7, puddleNoise);

      // Ground reflection is STRETCHED VERTICALLY (elongated toward camera)
      // This is because the ground is horizontal
      vec2 groundReflectPos = vec2(uVehiclePosition, 0.91);

      // Use different scales for X and Y to create streak effect
      float distX = abs(uv.x - groundReflectPos.x);
      float distY = abs(uv.y - groundReflectPos.y);

      // Streak: narrow in X, elongated in Y
      float streakX = exp(-distX * distX / 0.003); // Narrow
      float streakY = exp(-distY * distY / 0.008); // Elongated

      float groundGlow = streakX * streakY;

      // Puddle variation
      float reflectivity = mix(0.15, 0.5, puddle);

      // Emergency vehicles more visible
      float emergencyBoost = vType > 1.5 ? 1.5 : 1.0;

      vec3 groundReflection = vehicleColor * groundGlow * reflectivity * vehicleIntensity * groundStrength * emergencyBoost;
      finalColor = screenBlend(finalColor, groundReflection);
    }

    // ========== NEON EFFECTS ==========

    finalColor = applyNeonEffect(finalColor, neonMask, uTime, uOIntensity, uBIntensity);

    // ========== SUBTLE VIGNETTE ==========

    vec2 vignetteUV = (uv - 0.5) * vec2(1.05, 1.0);
    float vignette = 1.0 - smoothstep(0.6, 1.1, length(vignetteUV));
    finalColor *= 0.95 + vignette * 0.05;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

// ============================================
// VEHICLE SYSTEM
// ============================================

interface Vehicle {
  type: number;
  startTime: number;
  duration: number;
  direction: number;
}

// Track regular vehicles since last emergency
let regularVehicleCount = 0;
const MIN_REGULAR_BEFORE_EMERGENCY = 3;  // At least 3 regular cars before emergency
const MAX_REGULAR_BEFORE_EMERGENCY = 8;  // Max 8 regular cars before emergency
let nextEmergencyAfter = MIN_REGULAR_BEFORE_EMERGENCY + Math.floor(Math.random() * 5);

function getRandomVehicleType(): number {
  regularVehicleCount++;

  // After enough regular vehicles, chance for emergency
  if (regularVehicleCount >= nextEmergencyAfter) {
    regularVehicleCount = 0;
    nextEmergencyAfter = MIN_REGULAR_BEFORE_EMERGENCY + Math.floor(Math.random() * (MAX_REGULAR_BEFORE_EMERGENCY - MIN_REGULAR_BEFORE_EMERGENCY));

    // 60% police, 40% pompiers
    return Math.random() < 0.6 ? 2 : 3;
  }

  // Regular vehicle: 55% warm, 45% cool
  return Math.random() < 0.55 ? 0 : 1;
}

function getRandomInterval(): number {
  // Variable intervals to avoid routine
  const baseInterval = 2500 + Math.random() * 4000;  // 2.5-6.5 seconds base

  // Occasionally add extra pause (20% chance)
  const extraPause = Math.random() < 0.2 ? 3000 + Math.random() * 4000 : 0;

  return baseInterval + extraPause;
}

function getVehicleDuration(type: number): number {
  if (type === 2 || type === 3) {
    return 4000 + Math.random() * 2000;
  }
  return 2500 + Math.random() * 2000;
}

// ============================================
// EXTERIOR SCENE CLASS
// ============================================

// ============================================
// RAIN PARTICLE SYSTEM
// ============================================
// Based on: https://redstapler.co/three-js-realistic-rain-tutorial/
// Adapted for modern Three.js with BufferGeometry

// Rain area
const RAIN_AREA_X = 2.5;
const RAIN_AREA_Y = 3.0;
const WIND_BASE = 0.0012;      // Base wind speed (reduced 20%)
const WIND_ANGLE_BASE = 0.06;  // Base angle (reduced 20%)

// Front layer (closest, largest drops) - sizes -20%, speeds +50%
const RAIN_COUNT_FRONT = 1300;
const RAIN_SPEED_FRONT_MIN = 0.027;
const RAIN_SPEED_FRONT_MAX = 0.042;
const RAIN_LENGTH_FRONT_MIN = 0.04;
const RAIN_LENGTH_FRONT_MAX = 0.064;

// Middle layer - sizes -20%, speeds +50%
const RAIN_COUNT_MID = 1000;
const RAIN_SPEED_MID_MIN = 0.018;
const RAIN_SPEED_MID_MAX = 0.027;
const RAIN_LENGTH_MID_MIN = 0.024;
const RAIN_LENGTH_MID_MAX = 0.04;

// Back layer (furthest, smallest drops) - sizes -20%, speeds +50%
const RAIN_COUNT_BACK = 1000;
const RAIN_SPEED_BACK_MIN = 0.012;
const RAIN_SPEED_BACK_MAX = 0.02;
const RAIN_LENGTH_BACK_MIN = 0.012;
const RAIN_LENGTH_BACK_MAX = 0.02;

// Wind gust system with physics
const GUST_INTERVAL = 22;      // Full cycle (gust + recovery + normal)
const GUST_DURATION = 3;       // Gust lasts 3 seconds
const GUST_RECOVERY = 2;       // 2 seconds settling after gust
const GUST_STRENGTH = 0.002;   // Base gust force (reduced 75% total)
const DRAG = 0.92;             // Air resistance (velocity decay)
const TURBULENCE_STRENGTH = 0.00075;  // Random dispersion during gust (reduced 75% total)

let windTime = 0;

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
  // Organic variation
  const variation1 = Math.sin(windTime * 0.5) * 0.3;
  const variation2 = Math.sin(windTime * 1.3) * 0.15;
  const variation3 = Math.sin(windTime * 2.7) * 0.05;
  const totalVariation = variation1 + variation2 + variation3;

  // Check gust timing
  const cycleTime = windTime % GUST_INTERVAL;
  const gustActive = cycleTime < GUST_DURATION;
  const recovering = cycleTime >= GUST_DURATION && cycleTime < (GUST_DURATION + GUST_RECOVERY);

  let gustIntensity = 0;
  let gustForce = 0;
  let recoveryProgress = 0;

  if (gustActive) {
    const gustProgress = cycleTime / GUST_DURATION;
    // Asymmetric curve: quick attack, slow decay
    gustIntensity = gustProgress < 0.3
      ? gustProgress / 0.3  // Quick ramp up
      : 1 - ((gustProgress - 0.3) / 0.7) * 0.7;  // Slower decay

    gustForce = -GUST_STRENGTH * gustIntensity;  // Negative = from right
  } else if (recovering) {
    // Recovery period: gradually settle
    recoveryProgress = (cycleTime - GUST_DURATION) / GUST_RECOVERY;
  }

  return {
    baseSpeed: WIND_BASE * (1 + totalVariation * 0.5),
    baseAngle: WIND_ANGLE_BASE * (1 + totalVariation * 0.3),
    gustActive,
    recovering,
    gustIntensity,
    gustForce,
    recoveryProgress
  };
}

interface RainDrop {
  x: number;
  y: number;
  z: number;
  velocity: number;      // Vertical speed
  velocityX: number;     // Horizontal speed (wind effect)
  length: number;        // Streak length (motion blur)
  turbulence: number;    // Per-drop random turbulence factor
}

interface RainLayer {
  geometry: THREE.BufferGeometry;
  material: THREE.LineBasicMaterial;
  lines: THREE.LineSegments;
  drops: RainDrop[];
  speedMin: number;
  speedMax: number;
}

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
      velocityX: WIND_BASE,  // Initial horizontal velocity
      length: lengthMin + Math.random() * (lengthMax - lengthMin),
      turbulence: 0.5 + Math.random(),  // Random factor per drop (0.5 to 1.5)
    };
    drops.push(drop);

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

function createRainSystem(): RainLayer[] {
  // Front layer: closest, largest, fastest drops
  const frontLayer = createRainLayer(
    RAIN_COUNT_FRONT,
    RAIN_SPEED_FRONT_MIN, RAIN_SPEED_FRONT_MAX,
    0.6, 0.85,
    RAIN_LENGTH_FRONT_MIN, RAIN_LENGTH_FRONT_MAX,
    0.245  // 30% more transparent
  );

  // Middle layer: medium distance and size
  const midLayer = createRainLayer(
    RAIN_COUNT_MID,
    RAIN_SPEED_MID_MIN, RAIN_SPEED_MID_MAX,
    0.35, 0.55,
    RAIN_LENGTH_MID_MIN, RAIN_LENGTH_MID_MAX,
    0.175  // 30% more transparent
  );

  // Back layer: furthest, smallest, slowest drops
  const backLayer = createRainLayer(
    RAIN_COUNT_BACK,
    RAIN_SPEED_BACK_MIN, RAIN_SPEED_BACK_MAX,
    0.1, 0.3,
    RAIN_LENGTH_BACK_MIN, RAIN_LENGTH_BACK_MAX,
    0.105  // 30% more transparent
  );

  return [frontLayer, midLayer, backLayer];
}

function updateRainLayer(layer: RainLayer): void {
  const positions = layer.geometry.attributes.position.array as Float32Array;
  const drops = layer.drops;

  // Get current wind state
  const wind = getWindState();

  for (let i = 0; i < drops.length; i++) {
    const drop = drops[i];

    // === PHYSICS SIMULATION ===

    // Apply gust force with per-drop turbulence
    if (wind.gustActive) {
      // Random turbulence dispersion during gust
      const turbulenceX = (Math.random() - 0.5) * TURBULENCE_STRENGTH * drop.turbulence * wind.gustIntensity;
      const turbulenceY = (Math.random() - 0.3) * TURBULENCE_STRENGTH * 0.5 * wind.gustIntensity;  // Slight upward push

      // Apply gust force (each drop reacts differently based on turbulence factor)
      drop.velocityX += wind.gustForce * drop.turbulence + turbulenceX;
      drop.velocity = Math.max(drop.velocity + turbulenceY, layer.speedMin * 0.5);  // Slow down slightly during gust
    } else if (wind.recovering) {
      // Recovery period: very slow return to normal, still some residual chaos
      const targetVelocityX = wind.baseSpeed;
      const returnSpeed = 0.02 * wind.recoveryProgress;  // Starts very slow, speeds up
      drop.velocityX += (targetVelocityX - drop.velocityX) * returnSpeed;

      // Small residual turbulence during recovery
      const residualTurbulence = (1 - wind.recoveryProgress) * 0.0003;
      drop.velocityX += (Math.random() - 0.5) * residualTurbulence;
    } else {
      // Normal: gradually return to normal wind
      const targetVelocityX = wind.baseSpeed;
      drop.velocityX += (targetVelocityX - drop.velocityX) * 0.05;
    }

    // Apply drag (air resistance)
    drop.velocityX *= DRAG;

    // Move drop
    drop.y -= drop.velocity;
    drop.x += drop.velocityX;

    // Reset when out of bounds
    if (drop.y < -RAIN_AREA_Y / 2 || drop.x > RAIN_AREA_X / 2 || drop.x < -RAIN_AREA_X / 2 - 0.5) {
      drop.y = RAIN_AREA_Y / 2 + Math.random() * 0.5;
      drop.x = Math.random() * RAIN_AREA_X - RAIN_AREA_X / 2;
      drop.velocity = layer.speedMin + Math.random() * (layer.speedMax - layer.speedMin);
      drop.velocityX = wind.baseSpeed;
      drop.turbulence = 0.5 + Math.random();  // New random turbulence
    }

    // Update line positions
    const idx = i * 6;

    // Calculate streak angle based on current velocity
    const streakAngleX = drop.velocityX * 8;  // Amplify for visual

    // Start of streak (bottom)
    positions[idx] = drop.x;
    positions[idx + 1] = drop.y;
    positions[idx + 2] = drop.z;

    // End of streak (top, angle based on velocity)
    positions[idx + 3] = drop.x - streakAngleX * drop.length;
    positions[idx + 4] = drop.y + drop.length;
    positions[idx + 5] = drop.z;
  }

  layer.geometry.attributes.position.needsUpdate = true;
}

// Aspect ratio of the storefront image (5632x3072)
const TARGET_ASPECT_RATIO = 5632 / 3072; // ~1.833

export class ExteriorScene {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private material: THREE.ShaderMaterial;
  private startTime: number;
  private bPhaseOffset: number;
  private animationId: number = 0;
  private currentVehicle: Vehicle | null = null;
  private nextVehicleTime: number;
  private container: HTMLElement;

  // Rain system (multiple layers for depth)
  private rainLayers: RainLayer[];

  constructor(container: HTMLElement) {
    this.startTime = Date.now();
    this.bPhaseOffset = Math.random() * Math.PI * 2;
    this.nextVehicleTime = Date.now() + 2000;
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000); // Black background for letterboxing

    // Camera at z=1, looking at z=0 (storefront). Rain between camera and storefront.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3);
    this.camera.position.z = 1;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    // Initial resize with aspect ratio lock
    this.handleResize();

    // Load textures
    const textureLoader = new THREE.TextureLoader();

    const storefrontTexture = textureLoader.load('/storefront.jpeg');
    storefrontTexture.minFilter = THREE.LinearFilter;
    storefrontTexture.magFilter = THREE.LinearFilter;

    const maskTexture = textureLoader.load('/storefront-mask.png');
    maskTexture.minFilter = THREE.LinearFilter;
    maskTexture.magFilter = THREE.LinearFilter;

    // Create shader material for storefront
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: storefrontTexture },
        uMask: { value: maskTexture },
        uTime: { value: 0 },
        uOIntensity: { value: 1.0 },
        uBIntensity: { value: 1.0 },
        uVehiclePosition: { value: -0.5 },
        uVehicleType: { value: 0 },
        uVehicleActive: { value: 0.0 },
      },
      vertexShader,
      fragmentShader,
    });

    // Fullscreen quad for storefront image
    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.z = 0;  // At z=0
    this.scene.add(mesh);

    // Create rain particle system (two layers for depth)
    this.rainLayers = createRainSystem();
    for (const layer of this.rainLayers) {
      this.scene.add(layer.lines);
    }

    window.addEventListener('resize', this.handleResize);
    this.animate();
  }

  private handleResize = () => {
    const containerWidth = this.container.clientWidth || window.innerWidth;
    const containerHeight = this.container.clientHeight || window.innerHeight;
    const containerAspect = containerWidth / containerHeight;

    // Set renderer to fill container
    this.renderer.setSize(containerWidth, containerHeight);

    // Adjust camera frustum to maintain target aspect ratio
    // This creates letterboxing (black bars) when needed
    if (containerAspect > TARGET_ASPECT_RATIO) {
      // Container is wider than image - pillarbox (black bars on sides)
      const scale = containerAspect / TARGET_ASPECT_RATIO;
      this.camera.left = -scale;
      this.camera.right = scale;
      this.camera.top = 1;
      this.camera.bottom = -1;
    } else {
      // Container is taller than image - letterbox (black bars on top/bottom)
      const scale = TARGET_ASPECT_RATIO / containerAspect;
      this.camera.left = -1;
      this.camera.right = 1;
      this.camera.top = scale;
      this.camera.bottom = -scale;
    }

    this.camera.updateProjectionMatrix();
  };

  private updateVehicle(now: number) {
    if (!this.currentVehicle && now >= this.nextVehicleTime) {
      const type = getRandomVehicleType();
      this.currentVehicle = {
        type,
        startTime: now,
        duration: getVehicleDuration(type),
        direction: Math.random() > 0.5 ? 1 : -1,
      };
    }

    if (this.currentVehicle) {
      const elapsed = now - this.currentVehicle.startTime;
      const progress = elapsed / this.currentVehicle.duration;

      if (progress >= 1) {
        this.currentVehicle = null;
        this.nextVehicleTime = now + getRandomInterval();
        this.material.uniforms.uVehicleActive.value = 0.0;
      } else {
        const position = this.currentVehicle.direction > 0
          ? -0.3 + progress * 1.6
          : 1.3 - progress * 1.6;

        this.material.uniforms.uVehiclePosition.value = position;
        this.material.uniforms.uVehicleType.value = this.currentVehicle.type;

        const fadeIn = Math.min(progress * 5, 1);
        const fadeOut = Math.min((1 - progress) * 5, 1);
        this.material.uniforms.uVehicleActive.value = fadeIn * fadeOut;
      }
    }
  }

  private animate = () => {
    this.animationId = requestAnimationFrame(this.animate);

    const now = Date.now();
    const elapsed = (now - this.startTime) / 1000;
    const cycleDuration = 45;

    this.material.uniforms.uTime.value = elapsed;

    // O modulation
    const oPhase = (elapsed / cycleDuration) * Math.PI * 2;
    this.material.uniforms.uOIntensity.value = 0.1 + 0.9 * ((Math.cos(oPhase) + 1) / 2);

    // B modulation (desynchronized)
    const bPhase = (elapsed / cycleDuration) * Math.PI * 2 + this.bPhaseOffset;
    this.material.uniforms.uBIntensity.value = 0.1 + 0.9 * ((Math.cos(bPhase) + 1) / 2);

    this.updateVehicle(now);

    // Update wind time for variation
    windTime = elapsed;

    // Update rain layers
    for (const layer of this.rainLayers) {
      updateRainLayer(layer);
    }

    this.renderer.render(this.scene, this.camera);
  };

  public dispose() {
    window.removeEventListener('resize', this.handleResize);
    cancelAnimationFrame(this.animationId);
    this.renderer.domElement.remove();
    this.renderer.dispose();
    this.material.dispose();
  }
}
