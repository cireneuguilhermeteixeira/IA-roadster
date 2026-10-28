import * as THREE from "three";
import { GRAVITY, MASS, MAX_THRUST, type FlightInputs, type State } from "../physics";
import { decode, forward, type Genome, type Trace } from "./network";
import { encodeSensors } from "./sensors";

export function releaseHeading(state: State): THREE.Vector3 {
  const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(state.rotation);
  forward.y = 0;
  return forward.lengthSq() > 0.01 ? forward.normalize() : new THREE.Vector3(-1, 0, 0);
}

export function isLandingContact(
  state: State,
  landing: THREE.Vector3,
  surface: "ground" | "ramp" | null,
): surface is "ground" | "ramp" {
  return surface !== null && state.position.y <= landing.y + 3;
}

/** Keep full braking authority while falling fast, then require a slow descent. */
export function landingPowerLimit(state: State, landing: THREE.Vector3): number {
  const height = state.position.y - landing.y;
  const nearGround = 1 - THREE.MathUtils.smoothstep(height, 3, 8);
  const descent = Math.max(0, -state.velocity.y);
  const brakingNeed = THREE.MathUtils.smoothstep(descent, 1, 4);
  const belowHover = (MASS * -GRAVITY * 0.97) / (4 * MAX_THRUST);
  return 1 - nearGround * (1 - THREE.MathUtils.lerp(belowHover, 1, brakingNeed));
}

export function neuralFlightInputs(
  genome: Genome,
  state: State,
  landing: THREE.Vector3,
  heading: THREE.Vector3,
  elapsed: number,
  touching: boolean,
  throttle = 1,
): { controls: FlightInputs; trace: Trace } {
  const trace = forward(genome, encodeSensors(state, landing, elapsed, touching, heading));
  const controls: FlightInputs = {
    torque: new THREE.Vector3(),
    base: 0,
    forward: 0,
    lateral: 0,
    powerLimit: Math.min(throttle, landingPowerLimit(state, landing)),
    cutOnContact: true,
    touchdownCeiling: landing.y + 3,
    jets: decode(trace.outputs),
  };
  return { controls, trace };
}
