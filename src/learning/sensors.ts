import * as THREE from "three";
import type { State } from "../physics";

const clamp = (n: number, scale: number) => THREE.MathUtils.clamp(n / scale, -1, 1);
/** All state variables in the vehicle frame or relative to the landing site.
 * Swapping maps does not require modifying this schema.
 */
export function encodeSensors(state: State, landing: THREE.Vector3, elapsed: number): number[] {
  const qInv = state.rotation.clone().invert();
  const delta = landing.clone().sub(state.position).applyQuaternion(qInv);
  const localVelocity = state.velocity.clone().applyQuaternion(qInv);
  const localSpin = state.angularVelocity.clone().applyQuaternion(qInv);
  const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(qInv);
  const desiredForward = new THREE.Vector3(-1,0,0).applyQuaternion(qInv);
  return [
    clamp(delta.x,50),clamp(delta.y,50),clamp(delta.z,50),
    clamp(localVelocity.x,22),clamp(localVelocity.y,22),clamp(localVelocity.z,22),
    worldUp.x,worldUp.y,worldUp.z,
    desiredForward.x,desiredForward.y,desiredForward.z,
    clamp(localSpin.x,5),clamp(localSpin.y,5),clamp(localSpin.z,5),
    clamp(state.position.y-landing.y,60),
    clamp(elapsed,12),
    1,
  ];
}
export const SENSOR_LABELS = [
  "target local X","target local Y","target local Z",
  "velocity local X","velocity local Y","velocity local Z",
  "up local X","up local Y","up local Z",
  "forward local X","forward local Y","forward local Z",
  "angular X","angular Y","angular Z","height above target","elapsed time","bias",
];
