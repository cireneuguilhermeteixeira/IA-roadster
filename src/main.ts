import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createVisuals } from "./visuals";
import "./style.css";

// Rapier rigid-body dynamics; forces are applied independently at the four corners.
const {
  scene,
  camera,
  renderer,
  orbit,
  trackAt,
  trackLength,
  landingX,
  landingZ,
  rampLandingHeight,
  landingSurfaceAt,
  vehicle,
  body,
  thrusters,
} = createVisuals(document.querySelector<HTMLElement>("#viewport")!);

const ui = {
  alt: document.querySelector<HTMLElement>("#alt")!,
  att: document.querySelector<HTMLElement>("#att")!,
  speed: document.querySelector<HTMLElement>("#speed")!,
  status: document.querySelector<HTMLElement>("#status")!,
  power: document.querySelector<HTMLElement>("#powerbar")!,
  percent: document.querySelector<HTMLElement>("#percent")!,
  throttle: document.querySelector<HTMLInputElement>("#throttle")!,
  throttleValue: document.querySelector<HTMLElement>("#throttleValue")!,
  auto: document.querySelector<HTMLElement>("#auto")!,
  camera: document.querySelector<HTMLElement>("#camera")!,
};
let mode = "ready",
  trackDistance = 0,
  auto = false,
  follow = true,
  throttle = 0.5;
const keys: Record<string, boolean> = {};
const pos = new THREE.Vector3(),
  vel = new THREE.Vector3(),
  omega = new THREE.Vector3(),
  quat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD_AWAY_FROM_RAMP = new THREE.Vector3(-1, 0, 0);
const TARGET_UPRIGHT = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
// Approximate Subaru mass properties. All values are SI; tune against test scenarios.
const MASS = 1450;
const THRUST_MAX = 11000; // Newtons per thruster; 44 kN total > 14.2 kN vehicle weight.
const THRUST_RESPONSE = 5; // 1/s
const GIMBAL_RESPONSE = 4; // 1/s
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
let world: RAPIER.World;
let rigidBody: RAPIER.RigidBody;
function vec3(p: {x:number;y:number;z:number}) { return {x:p.x,y:p.y,z:p.z}; }
function syncBody() {
  const translation = rigidBody.translation();
  const rotation = rigidBody.rotation();
  pos.set(translation.x,translation.y,translation.z);
  quat.set(rotation.x,rotation.y,rotation.z,rotation.w);
  const linear = rigidBody.linvel();
  const angular = rigidBody.angvel();
  vel.set(linear.x,linear.y,linear.z);
  omega.set(angular.x,angular.y,angular.z);
  vehicle.position.copy(pos);
  vehicle.quaternion.copy(quat);
}

function placeOnTrack(distance: number) {
  const { point, angle } = trackAt(distance);
  pos
    .copy(point)
    .add(
      new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0).multiplyScalar(
        0.33,
      ),
    );
  quat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
  if (rigidBody) {
    rigidBody.setNextKinematicTranslation(vec3(pos));
    rigidBody.setNextKinematicRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
  }
  vehicle.position.copy(pos);
  vehicle.quaternion.copy(quat);
  return angle;
}
function reset() {
  mode = "ready";
  trackDistance = 0;
  placeOnTrack(0);
  vel.set(0, 0, 0);
  omega.set(0, 0, 0);
  body.position.set(0, 0, 0);
  throttle = 0.5;
  ui.throttle.value = "50";
  auto = false;
  ui.auto.textContent = "ESTABILIZAÇÃO: OFF";
  ui.status.textContent = "Pronto para percorrer a rampa.";
  ui.status.style.color = "#9bdcff";
  camera.position.set(52, 31, 47);
  orbit.target.set(0, 23, 0);
  if (rigidBody) {
    rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    rigidBody.setTranslation(vec3(pos), true);
    rigidBody.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
    rigidBody.setLinvel({x:0,y:0,z:0}, true);
    rigidBody.setAngvel({x:0,y:0,z:0}, true);
  }
  for (const t of thrusters) {
    t.power = 0;
    t.yaw.rotation.set(0, 0, 0);
    t.tilt.rotation.set(0, 0, 0);
    t.exhaust.visible = false;
    t.light.intensity = 0;
  }
}
function toggleAuto() {
  auto = !auto;
  ui.auto.textContent = `ESTABILIZAÇÃO: ${auto ? "ON" : "OFF"}`;
  if (mode === "flight")
    ui.status.textContent = auto
      ? "Estabilização ativa: corrigindo atitude e descendo para a marca."
      : "Estabilização desligada: controle manual.";
}
function launch() {
  if (mode !== "ready") reset();
  mode = "ramp";
  trackDistance = 0;
  ui.status.textContent = "Percorrendo a rampa curva…";
}
document.querySelector<HTMLElement>("#launch")!.onclick = launch;
document.querySelector<HTMLElement>("#reset")!.onclick = reset;
ui.auto.onclick = toggleAuto;
ui.camera.onclick = () => {
  follow = !follow;
  ui.camera.textContent = `CÂMERA: ${follow ? "SEGUIR" : "LIVRE"}`;
};
ui.throttle.oninput = () => (throttle = Number(ui.throttle.value) / 100);
const prevent = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);
addEventListener("keydown", (e: KeyboardEvent) => {
  if (prevent.has(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === "KeyT") toggleAuto();
  if (e.code === "KeyR") reset();
  if (e.code === "Enter") launch();
});
addEventListener("keyup", (e: KeyboardEvent) => {
  keys[e.code] = false;
});
addEventListener("blur", () => {
  for (const k in keys) keys[k] = false;
});
function axis(positive: string, negative: string) {
  return Number(!!keys[positive]) - Number(!!keys[negative]);
}
const worldAcceleration = new THREE.Vector3();

function desiredTorques() {
  // Torques in N*m, expressed in vehicle-local coordinates.
  const command = {
    x: axis("KeyA", "KeyD") * 14000,
    y: axis("KeyQ", "KeyE") * 8000,
    z: axis("KeyW", "KeyS") * 17000,
  };
  if (!auto) return command;
  const error = quat.clone().invert().multiply(TARGET_UPRIGHT);
  if (error.w < 0) error.set(-error.x, -error.y, -error.z, -error.w);
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(error.w, -1, 1));
  const sinHalf = Math.sqrt(Math.max(0, 1 - error.w * error.w));
  const axisError = sinHalf > 1e-4 ?
    new THREE.Vector3(error.x, error.y, error.z).divideScalar(sinHalf) :
    new THREE.Vector3();
  const localOmega = omega.clone().applyQuaternion(quat.clone().invert());
  return {
    x: command.x + THREE.MathUtils.clamp(axisError.x * angle * 13500 - localOmega.x * 11500, -19000, 19000),
    y: command.y + THREE.MathUtils.clamp(axisError.y * angle * 8000 - localOmega.y * 7800, -12500, 12500),
    z: command.z + THREE.MathUtils.clamp(axisError.z * angle * 15500 - localOmega.z * 13700, -24000, 24000),
  };
}

function automaticThrust() {
  const upAlignment = new THREE.Vector3(0, 1, 0).applyQuaternion(quat).y;
  if (upAlignment <= 0.35) return { base: 0, tiltX: 0, tiltZ: 0 };

  // Request a 3D acceleration: vertical descent plus lateral position hold.
  const targetVy =
    pos.y > 12
      ? -5
      : -Math.max(
          1.5,
          Math.sqrt(Math.max(pos.y - rampLandingHeight, 0)) * 1.35,
        );
  const desiredAy = THREE.MathUtils.clamp((targetVy - vel.y) * 2.8, -9, 30);
  const desiredThrust = new THREE.Vector3(
    THREE.MathUtils.clamp((landingX - pos.x) * 5 - vel.x * 5, -20, 20),
    9.81 + desiredAy,
    THREE.MathUtils.clamp((landingZ - pos.z) * 5 - vel.z * 5, -20, 20),
  );
  // The nozzles cannot ask for arbitrary side force while producing little lift.
  const maxSideThrust = desiredThrust.y * Math.tan(0.6);
  const sideThrust = Math.hypot(desiredThrust.x, desiredThrust.z);
  if (sideThrust > maxSideThrust) {
    const scale = maxSideThrust / sideThrust;
    desiredThrust.x *= scale;
    desiredThrust.z *= scale;
  }
  const localThrust = desiredThrust
    .clone()
    .applyQuaternion(quat.clone().invert());
  const tiltZ = THREE.MathUtils.clamp(
    -Math.atan2(localThrust.x, localThrust.y),
    -0.7,
    0.7,
  );
  const tiltX = THREE.MathUtils.clamp(
    Math.atan2(localThrust.z, Math.hypot(localThrust.x, localThrust.y)),
    -0.7,
    0.7,
  );
  const actualDirection = new THREE.Vector3(0, 1, 0)
    .applyEuler(new THREE.Euler(tiltX, 0, tiltZ))
    .applyQuaternion(quat);
  return {
    base:
      actualDirection.y > 0.1
        ? THREE.MathUtils.clamp(
            desiredThrust.y / ((4 * THRUST_MAX / MASS) * actualDirection.y),
            0,
            0.95,
          )
        : 0,
    tiltZ,
    tiltX,
  };
}

function simulate(dt: number) {
  if (mode === "ready") return;
  if (mode === "ramp") {
    trackDistance = Math.min(trackDistance + dt * 23, trackLength);
    const angle = placeOnTrack(trackDistance);
    world.timestep = dt;
    world.step();
    syncBody();
    if (trackDistance >= trackLength) {
      mode = "flight";
      rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      // Preserve launch velocity along the tangent of the inverted exit.
      rigidBody.setLinvel({x:23 * Math.cos(angle),y:23 * Math.sin(angle),z:0}, true);
      rigidBody.setAngvel({x:0,y:0,z:0}, true);
      syncBody();
      ui.status.textContent = "SAÍDA INVERTIDA! Controle os quatro propulsores.";
    }
    return;
  }
  if (mode === "landed") return;
  syncBody();
  const command = desiredTorques();
  const autopilot = auto ? automaticThrust() : null;
  const base = keys.ShiftLeft || keys.ShiftRight ? 1 : auto ? autopilot!.base : throttle;
  const strafe = axis("ArrowRight", "ArrowLeft") * 0.55;
  const forward = axis("ArrowUp", "ArrowDown") * 0.55;
  for (const t of thrusters) {
    const x = t.x, z = t.z;
    // For F=(0,F,0), torque r×F = (-z F, 0, x F).
    const requested = THREE.MathUtils.clamp(
      base + (-command.x * z / (4 * 1.08 * 1.08 * THRUST_MAX)) +
      (command.z * x / (4 * 1.8 * 1.8 * THRUST_MAX)), 0, 1
    );
    t.power = THREE.MathUtils.damp(t.power, requested, THRUST_RESPONSE, dt);
    const targetZ = THREE.MathUtils.clamp((autopilot?.tiltZ ?? 0) - strafe +
      command.y * x / 85000, -0.65, 0.65);
    const targetX = THREE.MathUtils.clamp((autopilot?.tiltX ?? 0) + forward +
      command.y * z / 60000, -0.65, 0.65);
    t.tilt.rotation.z = THREE.MathUtils.damp(t.tilt.rotation.z, targetZ, GIMBAL_RESPONSE, dt);
    t.tilt.rotation.x = THREE.MathUtils.damp(t.tilt.rotation.x, targetX, GIMBAL_RESPONSE, dt);
    const localForce = new THREE.Vector3(0, THRUST_MAX * t.power, 0).applyEuler(t.tilt.rotation);
    const worldForce = localForce.clone().applyQuaternion(quat);
    const point = new THREE.Vector3(x, -0.1, z).applyQuaternion(quat).add(pos);
    rigidBody.addForceAtPoint(vec3(worldForce), vec3(point), true);
    t.exhaust.visible = t.power > 0.025;
    t.exhaust.scale.y = 0.38 + t.power * 1.7;
    t.light.intensity = t.power * 5;
  }
  world.timestep = dt;
  world.step();
  syncBody();
  // Ground and ramp contacts handled by Rapier colliders. No position teleporting.
  if (pos.y < -12) {
    mode = "landed";
    ui.status.textContent = "Fora dos limites da simulação. Reinicie para tentar novamente.";
  }
}

async function initializePhysics() {
  await RAPIER.init();
  world = new RAPIER.World({x:0,y:-9.81,z:0});
  // Fixed ground (the detailed ramp still uses procedural geometry and a scripted kinematic launch).
  world.createCollider(RAPIER.ColliderDesc.cuboid(115,0.15,115).setTranslation(0,-0.15,0));
  const massProperties = RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setAdditionalMassProperties(
      MASS, {x:0,y:0,z:0}, {x:690,z:2800,y:3050}, IDENTITY
    );
  rigidBody = world.createRigidBody(massProperties);
  world.createCollider(RAPIER.ColliderDesc.cuboid(2.25,0.42,0.92).setTranslation(0,0.44,0).setDensity(0), rigidBody);
  reset();
}
const clock = new THREE.Clock();
let accumulator = 0;
const FIXED = 1 / 120;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  accumulator += dt;
  while (accumulator >= FIXED) {
    simulate(FIXED);
    accumulator -= FIXED;
  }
  const currentUp = new THREE.Vector3(0, 1, 0).applyQuaternion(quat),
    tilt =
      (Math.acos(THREE.MathUtils.clamp(currentUp.dot(UP), -1, 1)) * 180) /
      Math.PI;
  ui.alt.textContent = `${Math.max(0, pos.y - 0.67).toFixed(1)} m`;
  ui.att.textContent = `${tilt.toFixed(0)}°`;
  ui.speed.textContent = `${vel.y.toFixed(1)} m/s`;
  ui.status.dataset.position = `${pos.x.toFixed(2)},${pos.z.toFixed(2)}`;
  ui.percent.textContent = `${Math.round(throttle * 100)}%`;
  ui.throttleValue.textContent = `${Math.round(throttle * 100)}%`;
  ui.power.style.width = `${Math.round(throttle * 100)}%`;
  if (follow && mode === "flight") {
    const desired = new THREE.Vector3(13, 8, 19).add(pos);
    camera.position.lerp(desired, Math.min(1, 2.1 * dt));
    orbit.target.lerp(pos, Math.min(1, 3 * dt));
  }
  orbit.update();
  renderer.render(scene, camera);
}
initializePhysics().then(frame).catch((error) => {
  ui.status.textContent = `Falha ao inicializar Rapier: ${error}`;
  console.error(error);
});
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
