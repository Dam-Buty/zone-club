import { mat4, vec3 } from 'gl-matrix';

export class Camera {
  position: vec3;
  target: vec3;
  up: vec3;

  fov: number;
  aspect: number;
  near: number;
  far: number;

  // Mouse look
  yaw: number = -90; // Looking down -Z
  pitch: number = 0;
  sensitivity: number = 0.1;

  private viewMatrix: mat4;
  private projectionMatrix: mat4;
  private viewProjectionMatrix: mat4;

  constructor(aspect: number) {
    // Start near left entrance, looking into the store
    // Room: 10m x 15m, front wall at z=7.5, entrance on left at x=-2.5
    this.position = vec3.fromValues(-2.5, 1.7, 6); // Left side entrance, eye height ~1.7m
    this.target = vec3.fromValues(0, 1.7, 0);
    this.up = vec3.fromValues(0, 1, 0);
    this.yaw = -90; // Looking into the store (towards -Z)

    this.fov = Math.PI / 3; // 60 degrees
    this.aspect = aspect;
    this.near = 0.1;
    this.far = 100;

    this.viewMatrix = mat4.create();
    this.projectionMatrix = mat4.create();
    this.viewProjectionMatrix = mat4.create();

    this.updateProjection();
    this.updateView();
  }

  updateProjection() {
    mat4.perspective(
      this.projectionMatrix,
      this.fov,
      this.aspect,
      this.near,
      this.far
    );
  }

  updateView() {
    // Calculate direction from yaw and pitch
    const direction = vec3.fromValues(
      Math.cos(this.yaw * Math.PI / 180) * Math.cos(this.pitch * Math.PI / 180),
      Math.sin(this.pitch * Math.PI / 180),
      Math.sin(this.yaw * Math.PI / 180) * Math.cos(this.pitch * Math.PI / 180)
    );

    vec3.add(this.target, this.position, direction);
    mat4.lookAt(this.viewMatrix, this.position, this.target, this.up);
    mat4.multiply(this.viewProjectionMatrix, this.projectionMatrix, this.viewMatrix);
  }

  // Mouse movement for looking around
  onMouseMove(deltaX: number, deltaY: number) {
    this.yaw += deltaX * this.sensitivity;
    this.pitch -= deltaY * this.sensitivity;

    // Clamp pitch to avoid flipping
    this.pitch = Math.max(-89, Math.min(89, this.pitch));

    this.updateView();
  }

  // Move forward/backward along view direction
  moveForward(amount: number) {
    const direction = vec3.fromValues(
      Math.cos(this.yaw * Math.PI / 180),
      0, // Keep movement horizontal
      Math.sin(this.yaw * Math.PI / 180)
    );
    vec3.normalize(direction, direction);
    vec3.scaleAndAdd(this.position, this.position, direction, amount);
    this.updateView();
  }

  // Strafe left/right
  moveRight(amount: number) {
    const direction = vec3.fromValues(
      Math.cos(this.yaw * Math.PI / 180),
      0,
      Math.sin(this.yaw * Math.PI / 180)
    );
    const right = vec3.create();
    vec3.cross(right, direction, this.up);
    vec3.normalize(right, right);
    vec3.scaleAndAdd(this.position, this.position, right, amount);
    this.updateView();
  }

  setAspect(aspect: number) {
    this.aspect = aspect;
    this.updateProjection();
    this.updateView();
  }

  getViewProjectionMatrix(): Float32Array {
    return this.viewProjectionMatrix as Float32Array;
  }

  getViewMatrix(): Float32Array {
    return this.viewMatrix as Float32Array;
  }

  getProjectionMatrix(): Float32Array {
    return this.projectionMatrix as Float32Array;
  }

  getPosition(): Float32Array {
    return this.position as Float32Array;
  }
}
