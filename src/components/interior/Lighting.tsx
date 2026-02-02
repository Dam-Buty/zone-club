// LTC textures sont initialisées dans InteriorScene.tsx avant le Canvas

// Composant pour un tube néon au plafond
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

export function Lighting() {
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
    </>
  )
}
