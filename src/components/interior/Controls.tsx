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

// Marge de collision — rayon de protection ~0.25m
const COLLISION_MARGIN = 0.05;

// Définir les zones de collision (AABB: minX, maxX, minZ, maxZ)
const COLLISION_ZONES: {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  name: string;
}[] = [
  {
    minX: ROOM_WIDTH / 2 - 2.3 - 1.35 - 0.3,
    maxX: ROOM_WIDTH / 2 - 2.3 + 1.35 + 0.3,
    minZ: ROOM_DEPTH / 2 - 1.28 - 0.5,
    maxZ: ROOM_DEPTH / 2 - 1.28 + 0.5,
    name: "comptoir",
  },
  {
    minX: -1.6 - 0.756,
    maxX: -1.6 + 0.756,
    minZ: -1.134,
    maxZ: 1.134,
    name: "ilot",
  },
  {
    minX: 0.65 - 0.756,
    maxX: 0.65 + 0.756,
    minZ: -0.3 - 1.134,
    maxZ: -0.3 + 1.134,
    name: "ilot2",
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
const _tapNDC = new THREE.Vector2();  // mobile tap raycast position
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _lookAtMatrix = new THREE.Matrix4();
const _targetQuat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

// Seated camera position — world coordinates
// Couch at world x=2.5 (reculé 30cm), 40% zoom towards TV (x=4.0): distance 1.5*0.6=0.90
const SEATED_POSITION = new THREE.Vector3(3.452, 0.683, 1.2);
const SEATED_LOOKAT = new THREE.Vector3(4.225, 0.699, 1.2);
const SIT_TRANSITION_SPEED = 5.0; // lerp alpha — ~95% converged at 600ms

// LaZone CRT watch position — perpendicular to screen surface
// CRT origin: [4.2, 1.8, 3.95], Y-rot 65°, tilt -10°
// Screen world normal: (-0.893, -0.174, -0.417)
// Camera placed 0.3m along normal for face-on view (no trapezoid)
const LAZONE_WATCH_POSITION = new THREE.Vector3(3.92, 2.00, 3.83);
const LAZONE_WATCH_POSITION_MOBILE = new THREE.Vector3(3.78, 1.975, 3.77); // 50% further back
const LAZONE_WATCH_LOOKAT = new THREE.Vector3(4.2, 2.05, 3.95);

// Mobile pitch clamp — asymmetric: 45° up, 55° down
const MAX_PITCH_UP = (45 * Math.PI) / 180;
const MAX_PITCH_DOWN = (55 * Math.PI) / 180;
// OPTIMISATION: Layers Three.js pour le raycaster
export const RAYCAST_LAYER_CASSETTE = 1;
export const RAYCAST_LAYER_INTERACTIVE = 2;

type InteractiveTarget = "manager" | "bell" | "tv" | "couch" | "lazone" | null;

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

  // Sitting state tracking for standup animation
  const wasSittingRef = useRef(false);
  const preSitPosRef = useRef(new THREE.Vector3());

  // LaZone CRT watch tracking
  const wasWatchingLaZoneRef = useRef(false);
  const preWatchPosRef = useRef(new THREE.Vector3());
  const preWatchQuatRef = useRef(new THREE.Quaternion());

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
    camera.position.set(-3.0, 1.52, 3);
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
    // On desktop, require pointer lock (unless sitting or interacting with TV/LaZone).
    const { isSitting: sittingNow, isInteractingWithTV, isInteractingWithLaZone } = useStore.getState();
    if (!isMobile && !sittingNow && !isInteractingWithTV && !isInteractingWithLaZone && !controlsRef.current?.isLocked) return;

    const interactive = targetedInteractiveRef.current;

    // Stand up if sitting and not targeting something specific
    const { isSitting, setSitting } = useStore.getState();
    if (isSitting && !interactive) {
      setSitting(false);
      return;
    }

    // Standing TV interaction: forward select to TV menu
    if (isInteractingWithTV && !isSitting) {
      useStore.getState().dispatchTVMenu('select');
      return;
    }
    // Standing LaZone interaction: forward select to LaZone menu
    if (isInteractingWithLaZone && !isSitting) {
      useStore.getState().dispatchLaZoneMenu('select');
      return;
    }

    if (interactive === "manager" || interactive === "bell") {
      showManager();
      return;
    }
    if (interactive === "tv") {
      if (isSitting) {
        // Seated: route to TV menu instead of terminal
        useStore.getState().dispatchTVMenu('select');
      } else {
        // Standing: show 2-option TV menu instead of terminal
        useStore.getState().setInteractingWithTV(true);
      }
      return;
    }
    if (interactive === "couch") {
      if (!isSitting) {
        setSitting(true);
      }
      return;
    }
    if (interactive === "lazone") {
      const { isInteractingWithLaZone, isWatchingLaZone } = useStore.getState();
      if (isWatchingLaZone) return; // Already watching — ESC to exit
      if (isInteractingWithLaZone) {
        useStore.getState().dispatchLaZoneMenu('select');
      } else {
        useStore.getState().setInteractingWithLaZone(true);
      }
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
    const handleUnlock = () => {
      setPointerLocked(false);
      // Browser swallows ESC to exit pointer lock — clear LaZone states on unlock
      const { isWatchingLaZone, isInteractingWithLaZone } = useStore.getState();
      if (isWatchingLaZone) useStore.getState().setWatchingLaZone(false);
      if (isInteractingWithLaZone) useStore.getState().setInteractingWithLaZone(false);
    };
    controls.addEventListener("lock", handleLock);
    controls.addEventListener("unlock", handleUnlock);

    handleClickRef.current = () => {
      if (controls.isLocked) {
        // Click while watching LaZone → exit fully (watching + interacting)
        const { isWatchingLaZone } = useStore.getState();
        if (isWatchingLaZone) {
          useStore.getState().setWatchingLaZone(false);
          useStore.getState().setInteractingWithLaZone(false);
          return;
        }
        handleInteractionRef.current();
      } else {
        // Click without pointer lock — exit LaZone if active, otherwise re-lock
        const { isWatchingLaZone, isInteractingWithLaZone } = useStore.getState();
        if (isWatchingLaZone) {
          useStore.getState().setWatchingLaZone(false);
          useStore.getState().setInteractingWithLaZone(false);
          return;
        }
        if (isInteractingWithLaZone) {
          useStore.getState().setInteractingWithLaZone(false);
          return;
        }
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
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      const vhsOpen = useStore.getState().isVHSCaseOpen;
      if (vhsOpen) return;

      // ESC handling: LaZone watching → LaZone menu → TV menu → sitting → default
      if (event.code === "Escape") {
        const { isWatchingLaZone, isInteractingWithLaZone: laZoneMenu } = useStore.getState();
        if (isWatchingLaZone) {
          event.preventDefault();
          event.stopPropagation();
          useStore.getState().setWatchingLaZone(false);
          useStore.getState().setInteractingWithLaZone(false);
          return;
        }
        if (laZoneMenu) {
          event.preventDefault();
          event.stopPropagation();
          useStore.getState().setInteractingWithLaZone(false);
          return;
        }
        const { isSitting, isTerminalOpen, isInteractingWithTV } = useStore.getState();
        if (isInteractingWithTV && !isSitting) {
          event.preventDefault();
          event.stopPropagation();
          useStore.getState().setInteractingWithTV(false);
          return;
        }
        if (isSitting && !isTerminalOpen) {
          event.preventDefault();
          event.stopPropagation();
          useStore.getState().dispatchTVMenu('back');
          return;
        }
      }

      // Watching LaZone — channel zapping with up/down
      const { isWatchingLaZone: watchingLZ } = useStore.getState();
      if (watchingLZ) {
        if (event.code === "ArrowUp" || event.code === "KeyW") {
          event.preventDefault();
          useStore.getState().dispatchLaZoneChannel('prev');
          return;
        }
        if (event.code === "ArrowDown" || event.code === "KeyS") {
          event.preventDefault();
          useStore.getState().dispatchLaZoneChannel('next');
          return;
        }
        return; // Block all other keys while watching
      }

      // Standing LaZone interaction — intercept keys for menu navigation (left/right)
      const { isInteractingWithLaZone: laZoneInteracting } = useStore.getState();
      if (laZoneInteracting && !useStore.getState().isWatchingLaZone) {
        if (event.code === "ArrowLeft" || event.code === "KeyA") {
          event.preventDefault();
          useStore.getState().dispatchLaZoneMenu('left');
          return;
        }
        if (event.code === "ArrowRight" || event.code === "KeyD") {
          event.preventDefault();
          useStore.getState().dispatchLaZoneMenu('right');
          return;
        }
        if (event.code === "KeyE" || event.code === "Space" || event.code === "Enter") {
          event.preventDefault();
          handleInteractionRef.current();
          return;
        }
        return; // Block movement while interacting with LaZone
      }

      // Standing TV interaction — intercept keys for menu navigation
      const { isInteractingWithTV: interactingTV } = useStore.getState();
      if (interactingTV && !useStore.getState().isSitting) {
        if (event.code === "ArrowUp" || event.code === "KeyW") {
          event.preventDefault();
          useStore.getState().dispatchTVMenu('up');
          return;
        }
        if (event.code === "ArrowDown" || event.code === "KeyS") {
          event.preventDefault();
          useStore.getState().dispatchTVMenu('down');
          return;
        }
        if (event.code === "KeyE" || event.code === "Space" || event.code === "Enter") {
          event.preventDefault();
          handleInteractionRef.current();
          return;
        }
        // Block movement while interacting with TV
        return;
      }

      // Seated TV menu navigation — intercept movement keys
      const { isSitting: sittingNow } = useStore.getState();
      if (sittingNow) {
        if (event.code === "ArrowUp" || event.code === "KeyW") {
          event.preventDefault();
          useStore.getState().dispatchTVMenu('up');
          return;
        }
        if (event.code === "ArrowDown" || event.code === "KeyS") {
          event.preventDefault();
          useStore.getState().dispatchTVMenu('down');
          return;
        }
        if (event.code === "KeyE" || event.code === "Space" || event.code === "Enter") {
          event.preventDefault();
          handleInteractionRef.current();
          return;
        }
        // Block all other movement keys while sitting
        return;
      }

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
        const laZoneBusy = useStore.getState().isInteractingWithLaZone || useStore.getState().isWatchingLaZone;
        if (!vhsCaseOpen && !laZoneBusy) {
          // Apply camera rotation only when NOT inspecting a VHS case or LaZone
          _euler.setFromQuaternion(camera.quaternion, "YXZ");
          _euler.y += input.cameraYawDelta;
          _euler.x = THREE.MathUtils.clamp(
            _euler.x + input.cameraPitchDelta,
            -MAX_PITCH_UP,
            MAX_PITCH_DOWN,
          );
          camera.quaternion.setFromEuler(_euler);
        }
        // Always consume deltas to prevent accumulation
        input.cameraYawDelta = 0;
        input.cameraPitchDelta = 0;
      }

      // Mobile tap → direct raycast from tap position (no crosshair/hysteresis)
      if (input.tapInteraction) {
        input.tapInteraction = false;
        if (!useStore.getState().isVHSCaseOpen) {
          // Convert screen coords to NDC
          const ndcX = (input.tapScreenX / window.innerWidth) * 2 - 1;
          const ndcY = -(input.tapScreenY / window.innerHeight) * 2 + 1;
          _tapNDC.set(ndcX, ndcY);

          raycasterRef.current.setFromCamera(_tapNDC, camera);
          raycasterRef.current.far = 6;
          const intersects = raycasterRef.current.intersectObjects(
            scene.children,
            true,
          );

          for (const intersect of intersects) {
            // Check InstancedMesh cassettes
            if (
              intersect.object.userData?.isCassetteInstances &&
              intersect.instanceId !== undefined
            ) {
              const idToFilm = intersect.object.userData.instanceIdToFilmId as number[];
              const idToKey = intersect.object.userData.instanceIdToKey as string[];
              if (idToFilm && idToKey && intersect.instanceId < idToKey.length) {
                setTargetedFilm(idToFilm[intersect.instanceId], idToKey[intersect.instanceId]);
                onCassetteClick?.(idToFilm[intersect.instanceId]);
                break;
              }
            }

            // Check interactive objects (manager, bell, TV, couch)
            let obj: THREE.Object3D | null = intersect.object;
            let handled = false;
            while (obj) {
              if (obj.userData?.isManager || obj.userData?.isServiceBell) {
                showManager();
                handled = true;
                break;
              }
              if (obj.userData?.isLaZoneCRT) {
                const { isInteractingWithLaZone, isWatchingLaZone } = useStore.getState();
                if (isWatchingLaZone || isInteractingWithLaZone) {
                  // Menu/watching handled by HTML overlay (touch buttons)
                } else {
                  useStore.getState().setInteractingWithLaZone(true);
                }
                handled = true;
                break;
              }
              if (obj.userData?.isCouch) {
                if (!useStore.getState().isSitting) {
                  useStore.getState().setSitting(true);
                }
                handled = true;
                break;
              }
              if (obj.userData?.isTVScreen) {
                if (useStore.getState().isSitting) {
                  useStore.getState().dispatchTVMenu('select');
                } else {
                  useStore.getState().setInteractingWithTV(true);
                }
                handled = true;
                break;
              }
              if (obj.userData?.filmId && obj.userData?.cassetteKey) {
                setTargetedFilm(obj.userData.filmId, obj.userData.cassetteKey);
                onCassetteClick?.(obj.userData.filmId);
                handled = true;
                break;
              }
              obj = obj.parent;
            }
            if (handled) break;
          }
        }
      }
    }

    // === Raycasting (desktop only — mobile uses tap-based selection) ===
    if (!isMobile) {
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
            if (obj.userData?.isLaZoneCRT) {
              foundInteractive = "lazone";
              break;
            }
            if (obj.userData?.isCouch) {
              foundInteractive = "couch";
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

        // Sync to store (only on change to avoid re-renders)
        if (foundInteractive !== useStore.getState().targetedInteractive) {
          useStore.getState().setTargetedInteractive(foundInteractive);
        }

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
      if (useStore.getState().targetedInteractive !== null) {
        useStore.getState().setTargetedInteractive(null);
      }
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

    // === Watching LaZone CRT — zoom camera to fill 95% of screen ===
    const isWatchingLZ = useStore.getState().isWatchingLaZone;
    if (isWatchingLZ) {
      if (!wasWatchingLaZoneRef.current) {
        preWatchPosRef.current.copy(camera.position);
        preWatchQuatRef.current.copy(camera.quaternion);
      }
      wasWatchingLaZoneRef.current = true;
      const alpha = Math.min(1, SIT_TRANSITION_SPEED * delta);
      camera.position.lerp(isMobile ? LAZONE_WATCH_POSITION_MOBILE : LAZONE_WATCH_POSITION, alpha);
      _lookAtMatrix.lookAt(camera.position, LAZONE_WATCH_LOOKAT, _up);
      _targetQuat.setFromRotationMatrix(_lookAtMatrix);
      camera.quaternion.slerp(_targetQuat, alpha);
      return; // Skip movement
    }
    // === Return from LaZone zoom ===
    if (wasWatchingLaZoneRef.current) {
      const alpha = Math.min(1, SIT_TRANSITION_SPEED * delta);
      camera.position.lerp(preWatchPosRef.current, alpha);
      camera.quaternion.slerp(preWatchQuatRef.current, alpha);
      if (camera.position.distanceTo(preWatchPosRef.current) < 0.01) {
        camera.position.copy(preWatchPosRef.current);
        camera.quaternion.copy(preWatchQuatRef.current);
        wasWatchingLaZoneRef.current = false;
        // Safety: ensure interaction state is fully cleared after return
        if (useStore.getState().isInteractingWithLaZone) {
          useStore.getState().setInteractingWithLaZone(false);
        }
      }
      return;
    }

    // === Sitting on couch — smooth camera transition, skip movement ===
    const isSittingNow = useStore.getState().isSitting;
    if (isSittingNow) {
      if (!wasSittingRef.current) {
        // Save pre-sit position for safe standup
        preSitPosRef.current.copy(camera.position);
      }
      wasSittingRef.current = true;
      const alpha = Math.min(1, SIT_TRANSITION_SPEED * delta);
      camera.position.lerp(SEATED_POSITION, alpha);
      // Compute target quaternion facing the TV
      _lookAtMatrix.lookAt(camera.position, SEATED_LOOKAT, _up);
      _targetQuat.setFromRotationMatrix(_lookAtMatrix);
      camera.quaternion.slerp(_targetQuat, alpha);
      return; // Skip FPS movement
    }

    // === Standup transition — land behind the couch (couch at world X≈2.88) ===
    if (wasSittingRef.current) {
      const standingY = 1.52;
      const targetX = 2.4; // ~50cm behind couch, well outside TV collision zone
      const targetZ = 1.2; // same Z as couch/TV
      const alpha = Math.min(1, SIT_TRANSITION_SPEED * delta);
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, alpha);
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, standingY, alpha);
      camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, alpha);
      if (Math.abs(camera.position.y - standingY) < 0.01) {
        camera.position.set(targetX, standingY, targetZ);
        wasSittingRef.current = false;
        // Re-acquire pointer lock so movement resumes (desktop only)
        if (!isMobile) useStore.getState().requestPointerLock();
      }
      return; // Skip normal movement during standup
    }

    // === Movement ===
    if (!isActive) return;
    if (useStore.getState().isVHSCaseOpen) return;
    if (useStore.getState().isInteractingWithTV) return; // Block movement during standing TV menu
    if (useStore.getState().isInteractingWithLaZone) return; // Block movement during LaZone menu

    const speed = isMobile ? 1.1 : 1.75; // slower on mobile for precision near shelves
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
    camera.position.y = 1.52;
  });

  return null;
}
