// LTC textures sont initialisées dans InteriorScene.tsx avant le Canvas

// Mode d'éclairage: 'full' = 21 lumières, 'optimized' = 7 lumières
const LIGHTING_MODE: 'full' | 'optimized' = 'optimized'

// Composant pour un tube néon au plafond (mesh décoratif uniquement)
function NeonTube({ position, length = 1.2, color = '#ffffff' }: {
  position: [number, number, number]
  length?: number
  color?: string
}) {
  return (
    <group position={position}>
      {/* Tube lumineux */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.025, 0.025, length, 8]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={2}
          toneMapped={false}
        />
      </mesh>
      {/* Support/fixture */}
      <mesh position={[0, 0.04, 0]}>
        <boxGeometry args={[length + 0.1, 0.03, 0.08]} />
        <meshStandardMaterial color="#666666" roughness={0.5} metalness={0.3} />
      </mesh>
    </group>
  )
}

// Version OPTIMISÉE: 7 lumières au lieu de 21
function OptimizedLighting() {
  return (
    <>
      {/* 1. Lumière ambiante - réduite pour ambiance sombre */}
      <ambientLight intensity={0.25} color="#fff8f0" />

      {/* 2. Hemisphere light - éclairage naturel subtil */}
      <hemisphereLight
        color="#fff8f0"
        groundColor="#4a4a5a"
        intensity={0.2}
      />

      {/* 3. UNE SEULE RectAreaLight plafond (remplace 9) - intensité réduite */}
      <rectAreaLight
        width={10}
        height={8}
        intensity={1.2}
        color="#fff5e6"
        position={[0, 2.65, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      />

      {/* 4. PointLight manager (accent) */}
      <pointLight
        position={[3.5, 2.4, 2.8]}
        intensity={1}
        color="#fff5e6"
        distance={4}
        decay={2}
      />

      {/* 5. PointLight îlot central */}
      <pointLight
        position={[-0.8, 2.4, 0]}
        intensity={0.8}
        color="#fff5e6"
        distance={3}
        decay={2}
      />

      {/* 6. RectAreaLight vitrine - lumière urbaine nocturne */}
      <rectAreaLight
        width={4.5}
        height={1.2}
        intensity={1.5}
        color="#5c6bc0"
        position={[1.0, 0.8, 4.3]}
        rotation={[0, 0, 0]}
      />

      {/* 7. RectAreaLight porte - néon rose */}
      <rectAreaLight
        width={1.9}
        height={0.5}
        intensity={3}
        color="#ff2d95"
        position={[-3.2, 2.1, 4.3]}
        rotation={[0, 0, 0]}
      />

      {/* 8. RectAreaLight porte vitre principale */}
      <rectAreaLight
        width={1.8}
        height={1.4}
        intensity={1.5}
        color="#6a4c93"
        position={[-3.2, 1.1, 4.3]}
        rotation={[0, 0, 0]}
      />

      {/* Tubes néon décoratifs - toutes les rangées pour le visuel */}
      <NeonTube position={[-3, 2.7, -3]} length={1.4} color="#fff5e6" />
      <NeonTube position={[0, 2.7, -3]} length={1.4} color="#fff5e6" />
      <NeonTube position={[3, 2.7, -3]} length={1.4} color="#fff5e6" />
      <NeonTube position={[-3, 2.7, 0]} length={1.4} color="#fff5e6" />
      <NeonTube position={[0, 2.7, 0]} length={1.4} color="#fff5e6" />
      <NeonTube position={[3, 2.7, 0]} length={1.4} color="#fff5e6" />
      <NeonTube position={[-3, 2.7, 3]} length={1.4} color="#fff5e6" />
      <NeonTube position={[0, 2.7, 3]} length={1.4} color="#fff5e6" />
      <NeonTube position={[3, 2.7, 3]} length={1.4} color="#fff5e6" />
    </>
  )
}

// Version COMPLÈTE: 21 lumières (original)
function FullLighting() {
  return (
    <>
      {/* Lumière ambiante - augmentée pour plus de luminosité */}
      <ambientLight intensity={0.5} color="#fff8f0" />

      {/* ===== TUBES NÉON AU PLAFOND ===== */}

      {/* Rangée 1 (z = -3) */}
      <NeonTube position={[-3, 2.7, -3]} length={1.4} color="#fff5e6" />
      <NeonTube position={[0, 2.7, -3]} length={1.4} color="#fff5e6" />
      <NeonTube position={[3, 2.7, -3]} length={1.4} color="#fff5e6" />

      {/* Rangée 2 (z = 0) */}
      <NeonTube position={[-3, 2.7, 0]} length={1.4} color="#fff5e6" />
      <NeonTube position={[0, 2.7, 0]} length={1.4} color="#fff5e6" />
      <NeonTube position={[3, 2.7, 0]} length={1.4} color="#fff5e6" />

      {/* Rangée 3 (z = 3) - près de l'entrée */}
      <NeonTube position={[-3, 2.7, 3]} length={1.4} color="#fff5e6" />
      <NeonTube position={[0, 2.7, 3]} length={1.4} color="#fff5e6" />
      <NeonTube position={[3, 2.7, 3]} length={1.4} color="#fff5e6" />

      {/* ===== RECTAREA LIGHTS pour l'éclairage réel ===== */}

      {/* Grille 3x3 de RectAreaLights pour un éclairage uniforme */}
      {[-3, 0, 3].map((x) =>
        [-3, 0, 3].map((z) => (
          <rectAreaLight
            key={`rect-${x}-${z}`}
            width={1.2}
            height={0.15}
            intensity={8}
            color="#fff5e6"
            position={[x, 2.65, z]}
            rotation={[-Math.PI / 2, 0, 0]}
          />
        ))
      )}

      {/* ===== LUMIÈRES D'ACCENTUATION ===== */}

      {/* Lumière au-dessus du comptoir manager */}
      <pointLight
        position={[3.5, 2.4, 2.8]}
        intensity={1.5}
        color="#fff5e6"
        distance={5}
        decay={2}
      />

      {/* Lumière pour l'îlot central */}
      <pointLight
        position={[-0.8, 2.4, 0]}
        intensity={1.2}
        color="#fff5e6"
        distance={4}
        decay={2}
      />

      {/* Lumières pour les murs d'étagères */}
      <pointLight position={[-4.5, 2, 0]} intensity={0.8} color="#fff5e6" distance={4} decay={2} />
      <pointLight position={[4.5, 2, -1]} intensity={0.8} color="#fff5e6" distance={4} decay={2} />

      {/* Lumière directionnelle pour ombres douces */}
      <directionalLight
        position={[2, 8, 4]}
        intensity={0.4}
        color="#ffffff"
      />

      {/* Hemisphere light pour un éclairage naturel */}
      <hemisphereLight
        color="#fff8f0"
        groundColor="#4a4a5a"
        intensity={0.4}
      />

      {/* ===== LUMIÈRE URBAINE NOCTURNE (vitrine) ===== */}

      {/* === GRANDE VITRINE (côté GAUCHE vu de l'intérieur) === */}
      <rectAreaLight
        width={4.5}
        height={1.2}
        intensity={2}
        color="#5c6bc0"
        position={[1.0, 0.8, 4.3]}
        rotation={[0, 0, 0]}
      />

      {/* === PORTE VITRÉE (côté DROIT vu de l'intérieur) === */}
      <rectAreaLight
        width={1.9}
        height={0.5}
        intensity={5}
        color="#ff2d95"
        position={[-3.2, 2.1, 4.3]}
        rotation={[0, 0, 0]}
      />

      <rectAreaLight
        width={1.8}
        height={1.4}
        intensity={2.5}
        color="#6a4c93"
        position={[-3.2, 1.1, 4.3]}
        rotation={[0, 0, 0]}
      />

      <rectAreaLight
        width={1.8}
        height={0.4}
        intensity={1.5}
        color="#4a6fa5"
        position={[-3.2, 0.25, 4.3]}
        rotation={[0, 0, 0]}
      />

      {/* === ENSEIGNE VIDEOCLUB (au-dessus) === */}
      <rectAreaLight
        width={5}
        height={0.4}
        intensity={1.5}
        color="#9d4edd"
        position={[0.8, 2.7, 4.3]}
        rotation={[0, 0, 0]}
      />
    </>
  )
}

export function Lighting() {
  // Toggle entre les deux modes ici
  return LIGHTING_MODE === 'optimized' ? <OptimizedLighting /> : <FullLighting />
}
