import { useRef, useEffect, useCallback, type MutableRefObject } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { PointerLockControls as PointerLockControlsImpl } from "three/addons/controls/PointerLockControls.js";
import * as THREE from "three";
import { useStore } from "../../store";
import type { MobileInput } from "../../types/mobile";

interface ControlsProps {
  onCassetteClick?: (filmId: number) => void;
  isMobile?: boolean;
  mobileInputRef?: MutableRefObject<MobileInput>;
}

// Dimensions de la pièce
const ROOM_WIDTH = 9;
const ROOM_DEPTH = 8.5;

// Marge de collision (7% de distance minimum)
const COLLISION_MARGIN = 0.07;

// Définir les zones de collision (AABB: minX, maxX, minZ, maxZ)
const COLLISION_ZONES: {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  name: string;
}[] = [
  {
    minX: ROOM_WIDTH / 2 - 2.3 - 1.5 - 0.3,
    maxX: ROOM_WIDTH / 2 - 2.3 + 1.5 + 0.3,
    minZ: ROOM_DEPTH / 2 - 1.5 - 0.5,
    maxZ: ROOM_DEPTH / 2 - 1.5 + 0.5,
    name: "comptoir",
  },
  {
    minX: -0.8 - 0.756,
    maxX: -0.8 + 0.756,
    minZ: -1.134,
    maxZ: 1.134,
    name: "ilot",
  },
  {
    minX: ROOM_WIDTH / 2 - 1.2,
    maxX: ROOM_WIDTH / 2,
    minZ: 0.5,
    maxZ: 2.5,
    name: "tv",
  },
  {
    minX: -ROOM_WIDTH / 2,
    maxX: -ROOM_WIDTH / 2 + 0.8,
    minZ: -ROOM_DEPTH / 2,
    maxZ: ROOM_DEPTH / 2,
    name: "etagere-gauche",
  },
  {
    minX: -ROOM_WIDTH / 2,
    maxX: ROOM_WIDTH / 2 - 1.5,
    minZ: -ROOM_DEPTH / 2,
    maxZ: -ROOM_DEPTH / 2 + 0.8,
    name: "etagere-fond",
  },
  {
    minX: ROOM_WIDTH / 2 - 0.8,
    maxX: ROOM_WIDTH / 2,
    minZ: -ROOM_DEPTH / 2,
    maxZ: 0.5,
    name: "etagere-droite-nord",
  },
  {
    minX: ROOM_WIDTH / 2 - 1,
    maxX: ROOM_WIDTH / 2,
    minZ: 1.5,
    maxZ: 3,
    name: "games",
  },
  {
    minX: ROOM_WIDTH / 2 - 1.5,
    maxX: ROOM_WIDTH / 2,
    minZ: 3,
    maxZ: 4,
    name: "escalier",
  },
  {
    minX: ROOM_WIDTH / 2 - 1.0,
    maxX: ROOM_WIDTH / 2,
    minZ: -ROOM_DEPTH / 2,
    maxZ: -ROOM_DEPTH / 2 + 0.5,
    name: "porte-privee",
  },
  {
    minX: -ROOM_WIDTH / 2,
    maxX: -ROOM_WIDTH / 2 + 1,
    minZ: -ROOM_DEPTH / 2,
    maxZ: -ROOM_DEPTH / 2 + 1,
    name: "plante",
  },
];

function checkCollision(x: number, z: number, margin: number): boolean {
  for (const zone of COLLISION_ZONES) {
    const expandedMinX = zone.minX - margin;
    const expandedMaxX = zone.maxX + margin;
    const expandedMinZ = zone.minZ - margin;
    const expandedMaxZ = zone.maxZ + margin;

    if (
      x >= expandedMinX &&
      x <= expandedMaxX &&
      z >= expandedMinZ &&
      z <= expandedMaxZ
    ) {
      return true;
    }
  }
  return false;
}

// Static reusable objects (avoid per-frame allocation)
const SCREEN_CENTER = new THREE.Vector2(0, 0);
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

// Mobile pitch clamp (±60°)
const MAX_PITCH = (60 * Math.PI) / 180;
// OPTIMISATION: Layers Three.js pour le raycaster
export const RAYCAST_LAYER_CASSETTE = 1;
export const RAYCAST_LAYER_INTERACTIVE = 2;

type InteractiveTarget = "manager" | "bell" | "tv" | null;

export function Controls({
  onCassetteClick,
  isMobile,
  mobileInputRef,
}: ControlsProps) {
  const { camera, gl, scene } = useThree();
  const setTargetedFilm = useStore((state) => state.setTargetedFilm);
  const setPointerLocked = useStore((state) => state.setPointerLocked);
  const showManager = useStore((state) => state.showManager);
  const openTerminal = useStore((state) => state.openTerminal);
  const requestPointerUnlock = useStore((state) => state.requestPointerUnlock);
  const pointerLockRequested = useStore((state) => state.pointerLockRequested);
  const clearPointerLockRequest = useStore(
    (state) => state.clearPointerLockRequest,
  );
  const controlsRef = useRef<PointerLockControlsImpl | null>(null);

  // OPTIMISATION: Raycaster avec layers
  const raycasterRef = useRef<THREE.Raycaster>(null!);
  if (!raycasterRef.current) {
    raycasterRef.current = new THREE.Raycaster();
    raycasterRef.current.layers.set(RAYCAST_LAYER_CASSETTE);
    raycasterRef.current.layers.enable(RAYCAST_LAYER_INTERACTIVE);
  }

  // Desktop keyboard refs
  const moveForward = useRef(false);
  const moveBackward = useRef(false);
  const moveLeft = useRef(false);
  const moveRight = useRef(false);
  const velocity = useRef(new THREE.Vector3());
  const direction = useRef(new THREE.Vector3());

  // Cible interactive actuelle
  const targetedInteractiveRef = useRef<InteractiveTarget>(null);

  // Hystérésis pour sélection cassettes
  const lastCassetteKeyRef = useRef<string | null>(null)
  const lastFilmIdRef = useRef<number | null>(null)
  const deselectTimerRef = useRef<number>(0)
  const hitCountRef = useRef<number>(0)
  const DESELECT_DELAY = isMobile ? 0.25 : 0.4
  const MIN_HITS_TO_CHANGE = isMobile ? 3 : 10 // Mobile: instant (3 hits ~0.15s), Desktop: ~0.5s

  // Throttle raycast
  const frameCountRef = useRef(0);
  const RAYCAST_INTERVAL = isMobile ? 3 : 3; // 20/sec both mobile & desktop

  // Configurer la caméra
  useEffect(() => {
    camera.position.set(-3.0, 1.6, 3);
    camera.near = 0.1;
    camera.far = 15;
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = isMobile ? 80 : 70; // wider FOV on mobile for spatial awareness on small screens
      camera.updateProjectionMatrix();
    }
  }, [camera, isMobile]);

  // Vérifier si un overlay est ouvert
  const managerVisible = useStore((state) => state.managerVisible);
  const selectedFilmId = useStore((state) => state.selectedFilmId);
  const isTerminalOpen = useStore((state) => state.isTerminalOpen);
  const isVHSCaseOpen = useStore((state) => state.isVHSCaseOpen);

  // Gérer les demandes de lock/unlock depuis le store (desktop only)
  useEffect(() => {
    if (isMobile) return;
    if (!controlsRef.current || !pointerLockRequested) return;

    const hasOverlayOpen =
      managerVisible || selectedFilmId !== null || isTerminalOpen;

    if (pointerLockRequested === "unlock" && controlsRef.current.isLocked) {
      controlsRef.current.unlock();
    } else if (
      pointerLockRequested === "lock" &&
      !controlsRef.current.isLocked &&
      !hasOverlayOpen
    ) {
      controlsRef.current.lock();
    }
    clearPointerLockRequest();
  }, [
    isMobile,
    pointerLockRequested,
    clearPointerLockRequest,
    managerVisible,
    selectedFilmId,
    isTerminalOpen,
    isVHSCaseOpen,
  ]);

  // Interaction handler (shared between desktop click/key and mobile tap)
  const handleInteraction = useCallback(() => {
    // On desktop, require pointer lock. On mobile, always active.
    if (!isMobile && !controlsRef.current?.isLocked) return;

    const interactive = targetedInteractiveRef.current;
    if (interactive === "manager" || interactive === "bell") {
      showManager();
      return;
    }
    if (interactive === "tv") {
      openTerminal();
      if (!isMobile) requestPointerUnlock();
      return;
    }

    const targetedFilmId = useStore.getState().targetedFilmId;
    if (targetedFilmId !== null) {
      onCassetteClick?.(targetedFilmId);
      if (!isMobile) requestPointerUnlock();
    }
  }, [
    isMobile,
    onCassetteClick,
    showManager,
    openTerminal,
    requestPointerUnlock,
  ]);

  // Stable ref for handleInteraction
  const handleInteractionRef = useRef(handleInteraction);
  useEffect(() => {
    handleInteractionRef.current = handleInteraction;
  }, [handleInteraction]);

  // Mobile: mark as pointer-locked on mount (always "active")
  useEffect(() => {
    if (isMobile) {
      setPointerLocked(true);
      return () => {
        setPointerLocked(false);
      };
    }
  }, [isMobile, setPointerLocked]);

  // Desktop: create PointerLockControls + keyboard listeners
  const controlsCreated = useRef(false);
  const handleClickRef = useRef<(() => void) | null>(null);
  const handleKeyDownRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  const handleKeyUpRef = useRef<((e: KeyboardEvent) => void) | null>(null);

  useEffect(() => {
    if (isMobile) return;
    if (controlsCreated.current) return;
    controlsCreated.current = true;

    const controls = new PointerLockControlsImpl(camera, gl.domElement);
    if ("pointerSpeed" in controls) {
      (controls as unknown as { pointerSpeed: number }).pointerSpeed = 0.7;
    }
    controlsRef.current = controls;

    const handleLock = () => setPointerLocked(true);
    const handleUnlock = () => setPointerLocked(false);
    controls.addEventListener("lock", handleLock);
    controls.addEventListener("unlock", handleUnlock);

    handleClickRef.current = () => {
      if (controls.isLocked) {
        handleInteractionRef.current();
      } else {
        const state = useStore.getState();
        const hasOverlayOpen =
          state.managerVisible ||
          state.selectedFilmId !== null ||
          state.isTerminalOpen;
        if (!hasOverlayOpen) {
          controls.lock();
        }
      }
    };

    handleKeyDownRef.current = (event: KeyboardEvent) => {
      const vhsOpen = useStore.getState().isVHSCaseOpen;
      if (vhsOpen) return;

      switch (event.code) {
        case "KeyW":
        case "ArrowUp":
          moveForward.current = true;
          break;
        case "KeyS":
        case "ArrowDown":
          moveBackward.current = true;
          break;
        case "KeyA":
        case "ArrowLeft":
          moveLeft.current = true;
          break;
        case "KeyD":
        case "ArrowRight":
          moveRight.current = true;
          break;
        case "KeyE":
        case "Space":
          handleInteractionRef.current();
          break;
      }
    };

    handleKeyUpRef.current = (event: KeyboardEvent) => {
      switch (event.code) {
        case "KeyW":
        case "ArrowUp":
          moveForward.current = false;
          break;
        case "KeyS":
        case "ArrowDown":
          moveBackward.current = false;
          break;
        case "KeyA":
        case "ArrowLeft":
          moveLeft.current = false;
          break;
        case "KeyD":
        case "ArrowRight":
          moveRight.current = false;
          break;
      }
    };

    gl.domElement.addEventListener("click", handleClickRef.current);
    document.addEventListener("keydown", handleKeyDownRef.current);
    document.addEventListener("keyup", handleKeyUpRef.current);

    return () => {
      if (handleClickRef.current) {
        gl.domElement.removeEventListener("click", handleClickRef.current);
      }
      if (handleKeyDownRef.current) {
        document.removeEventListener("keydown", handleKeyDownRef.current);
      }
      if (handleKeyUpRef.current) {
        document.removeEventListener("keyup", handleKeyUpRef.current);
      }
      controls.removeEventListener("lock", handleLock);
      controls.removeEventListener("unlock", handleUnlock);
      controls.dispose();
      controlsRef.current = null;
      controlsCreated.current = false;
      setPointerLocked(false);
    };
  }, [isMobile, camera, gl, setPointerLocked]);

  // Main loop — movement + targeting
  useFrame((_, delta) => {
    frameCountRef.current++;

    // Determine if controls are active
    const isActive = isMobile ? true : !!controlsRef.current?.isLocked;

    // === Mobile camera look ===
    if (isMobile && mobileInputRef) {
      const input = mobileInputRef.current;
      const vhsCaseOpen = useStore.getState().isVHSCaseOpen;

      if (input.cameraYawDelta !== 0 || input.cameraPitchDelta !== 0) {
        if (!vhsCaseOpen) {
          // Apply camera rotation only when NOT inspecting a VHS case
          _euler.setFromQuaternion(camera.quaternion, "YXZ");
          _euler.y += input.cameraYawDelta;
          _euler.x = THREE.MathUtils.clamp(
            _euler.x + input.cameraPitchDelta,
            -MAX_PITCH,
            MAX_PITCH,
          );
          camera.quaternion.setFromEuler(_euler);
        }
        // Always consume deltas to prevent accumulation
        input.cameraYawDelta = 0;
        input.cameraPitchDelta = 0;
      }

      // Mobile tap interaction
      if (input.tapInteraction) {
        input.tapInteraction = false;
        handleInteractionRef.current();
      }
    }

    // === Raycasting ===
    const shouldRaycast = frameCountRef.current % RAYCAST_INTERVAL === 0;

    if (isActive && shouldRaycast) {
      raycasterRef.current.setFromCamera(SCREEN_CENTER, camera);
      raycasterRef.current.far = 6;
      const intersects = raycasterRef.current.intersectObjects(
        scene.children,
        true,
      );

      let foundFilmId: number | null = null;
      let foundCassetteKey: string | null = null;
      let foundInteractive: InteractiveTarget = null;

      for (const intersect of intersects) {
        if (
          intersect.object.userData?.isCassetteInstances &&
          intersect.instanceId !== undefined
        ) {
          const idToKey = intersect.object.userData.instanceIdToKey as string[];
          const idToFilm = intersect.object.userData
            .instanceIdToFilmId as number[];
          if (idToKey && idToFilm && intersect.instanceId < idToKey.length) {
            foundFilmId = idToFilm[intersect.instanceId];
            foundCassetteKey = idToKey[intersect.instanceId];
            break;
          }
        }

        let obj: THREE.Object3D | null = intersect.object;
        while (obj) {
          if (obj.userData?.isManager) {
            foundInteractive = "manager";
            break;
          }
          if (obj.userData?.isServiceBell) {
            foundInteractive = "bell";
            break;
          }
          if (obj.userData?.isTVScreen) {
            foundInteractive = "tv";
            break;
          }
          if (obj.userData?.filmId && obj.userData?.cassetteKey) {
            foundFilmId = obj.userData.filmId;
            foundCassetteKey = obj.userData.cassetteKey;
            break;
          }
          obj = obj.parent;
        }
        if (foundInteractive || foundFilmId !== null) break;
      }

      targetedInteractiveRef.current = foundInteractive;

      // Hystérésis cassette selection
      const currentCassetteKey = lastCassetteKeyRef.current;

      if (foundCassetteKey) {
        deselectTimerRef.current = 0;
        if (foundCassetteKey === currentCassetteKey) {
          hitCountRef.current = Math.min(hitCountRef.current + 1, 10);
        } else if (currentCassetteKey === null) {
          lastCassetteKeyRef.current = foundCassetteKey;
          lastFilmIdRef.current = foundFilmId;
          hitCountRef.current = 1;
          setTargetedFilm(foundFilmId, foundCassetteKey);
        } else {
          hitCountRef.current++;
          if (hitCountRef.current >= MIN_HITS_TO_CHANGE) {
            lastCassetteKeyRef.current = foundCassetteKey;
            lastFilmIdRef.current = foundFilmId;
            hitCountRef.current = 1;
            setTargetedFilm(foundFilmId, foundCassetteKey);
          }
        }
      } else if (currentCassetteKey) {
        hitCountRef.current = 0;
        deselectTimerRef.current += delta;
        if (deselectTimerRef.current >= DESELECT_DELAY) {
          lastCassetteKeyRef.current = null;
          lastFilmIdRef.current = null;
          deselectTimerRef.current = 0;
          setTargetedFilm(null, null);
        }
      }

      // Cursor (desktop only)
      if (!isMobile) {
        if (foundInteractive || lastCassetteKeyRef.current !== null) {
          document.body.style.cursor = "pointer";
        } else {
          document.body.style.cursor = "crosshair";
        }
      }
    }

    // Reset targeting when not active
    if (!isActive) {
      targetedInteractiveRef.current = null;
      if (
        lastCassetteKeyRef.current !== null ||
        lastFilmIdRef.current !== null
      ) {
        lastCassetteKeyRef.current = null;
        lastFilmIdRef.current = null;
        deselectTimerRef.current = 0;
        setTargetedFilm(null, null);
      }
      if (!isMobile) document.body.style.cursor = "default";
    }

    // === Movement ===
    if (!isActive) return;
    if (useStore.getState().isVHSCaseOpen) return;

    const speed = isMobile ? 2.2 : 1.75; // faster on mobile — joystick rarely hits 100% deflection
    velocity.current.x -= velocity.current.x * 10.0 * delta;
    velocity.current.z -= velocity.current.z * 10.0 * delta;

    if (isMobile && mobileInputRef) {
      // Mobile: read joystick input
      const input = mobileInputRef.current;
      direction.current.x = input.moveX;
      direction.current.z = input.moveZ;
      // No normalize needed — joystick already normalized to -1..1
    } else {
      // Desktop: read keyboard booleans
      direction.current.z =
        Number(moveForward.current) - Number(moveBackward.current);
      direction.current.x =
        Number(moveRight.current) - Number(moveLeft.current);
      direction.current.normalize();
    }

    if (direction.current.z !== 0 || direction.current.x !== 0) {
      velocity.current.z -= direction.current.z * speed * delta;
      velocity.current.x -= direction.current.x * speed * delta;
    }

    const oldX = camera.position.x;
    const oldZ = camera.position.z;

    if (isMobile) {
      // Mobile: manual movement using camera matrix columns
      // (no PointerLockControls.moveRight/moveForward available)
      _euler.setFromQuaternion(camera.quaternion, "YXZ");
      const yaw = _euler.y;
      _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      _right.set(Math.cos(yaw), 0, -Math.sin(yaw));

      camera.position.addScaledVector(_right, -velocity.current.x);
      camera.position.addScaledVector(_forward, -velocity.current.z);
    } else {
      if (!controlsRef.current) return;
      controlsRef.current.moveRight(-velocity.current.x);
      controlsRef.current.moveForward(-velocity.current.z);
    }

    // Wall limits
    const WALL_MARGIN = 0.5;
    let newX = Math.max(
      -ROOM_WIDTH / 2 + WALL_MARGIN,
      Math.min(ROOM_WIDTH / 2 - WALL_MARGIN, camera.position.x),
    );
    let newZ = Math.max(
      -ROOM_DEPTH / 2 + WALL_MARGIN,
      Math.min(ROOM_DEPTH / 2 - WALL_MARGIN, camera.position.z),
    );

    // Collision check
    const collisionDist = 0.5 * COLLISION_MARGIN * 10;
    if (checkCollision(newX, newZ, collisionDist)) {
      if (!checkCollision(newX, oldZ, collisionDist)) {
        newZ = oldZ;
      } else if (!checkCollision(oldX, newZ, collisionDist)) {
        newX = oldX;
      } else {
        newX = oldX;
        newZ = oldZ;
      }
    }

    camera.position.x = newX;
    camera.position.z = newZ;
    camera.position.y = 1.6;
  });

  return null;
}
