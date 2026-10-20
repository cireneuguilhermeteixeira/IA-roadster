import * as THREE from "three";
import { MASS, MAX_THRUST, type State, type FlightInputs } from "./physics";

export class FlightController {
  private readonly target = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    Math.PI,
  );
  command(
    state: State,
    keys: Record<string, boolean>,
    auto: boolean,
    throttle: number,
    landing: THREE.Vector3,
  ): FlightInputs {
    const powerLimit = THREE.MathUtils.clamp(throttle, 0, 1);
    if (powerLimit === 0) {
      return {
        torque: new THREE.Vector3(),
        base: 0,
        powerLimit: 0,
        forward: 0,
        lateral: 0,
      };
    }
    const axis = (plus: string, minus: string) =>
      Number(Boolean(keys[plus])) - Number(Boolean(keys[minus]));
    const torque = new THREE.Vector3(
      axis("KeyA", "KeyD") * 3000,
      axis("KeyQ", "KeyE") * 2000,
      axis("KeyW", "KeyS") * 4000,
    );
    let base = powerLimit;
    if (auto) {
      const inverseRotation = state.rotation.clone().invert();
      const error = inverseRotation.clone().multiply(this.target);
      if (error.w < 0) error.set(-error.x, -error.y, -error.z, -error.w);
      const magnitude = 2 * Math.atan2(Math.hypot(error.x, error.y, error.z), Math.abs(error.w));
      const direction = new THREE.Vector3(error.x, error.y, error.z).normalize();
      const omega = state.angularVelocity.clone().applyQuaternion(inverseRotation);
      torque.add(
        new THREE.Vector3(
          direction.x * magnitude * 2500 - omega.x * 1200,
          direction.y * magnitude * 1600 - omega.y * 900,
          direction.z * magnitude * 2500 - omega.z * 1400,
        ),
      );
      torque.clampLength(0, 6500);
      const descendTarget = state.position.y > 6 ? -2.5 : -0.8;
      const verticalAcceleration = THREE.MathUtils.clamp(
        (descendTarget - state.velocity.y) * 2,
        -5,
        6,
      );
      const desired = new THREE.Vector3(
        THREE.MathUtils.clamp((landing.x - state.position.x) * 1.2 - state.velocity.x * 2.2, -8, 8),
        9.81 + verticalAcceleration,
        THREE.MathUtils.clamp((landing.z - state.position.z) * 1.2 - state.velocity.z * 2.2, -8, 8),
      );
      base = THREE.MathUtils.clamp((MASS * desired.length()) / (4 * MAX_THRUST), 0, 1);
      return {
        torque,
        base,
        powerLimit,
        thrustDirection: desired.normalize(),
        forward: axis("ArrowUp", "ArrowDown") * 0.35,
        lateral: axis("ArrowRight", "ArrowLeft") * 0.35,
      };
    }
    return {
      torque,
      base,
      powerLimit,
      forward: axis("ArrowUp", "ArrowDown") * 0.35,
      lateral: axis("ArrowRight", "ArrowLeft") * 0.35,
    };
  }
}
