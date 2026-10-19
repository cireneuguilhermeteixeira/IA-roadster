import * as THREE from "three";
import { createVisuals } from "./visuals.js";
import "./style.css";

// Forces and torques are deliberately simplified for arcade flight.
const {
  scene,
  camera,
  renderer,
  orbit,
  trackAt,
  trackLength,
  landingX,
  landingZ,
  vehicle,
  body,
  thrusters,
} = createVisuals(document.querySelector("#viewport"));

const ui = {
  alt: document.querySelector("#alt"),
  att: document.querySelector("#att"),
  speed: document.querySelector("#speed"),
  status: document.querySelector("#status"),
  power: document.querySelector("#powerbar"),
  percent: document.querySelector("#percent"),
  throttle: document.querySelector("#throttle"),
  throttleValue: document.querySelector("#throttleValue"),
  auto: document.querySelector("#auto"),
  camera: document.querySelector("#camera"),
};
let mode = "ready",
  trackDistance = 0,
  auto = false,
  follow = true,
  throttle = 0.5;
const keys = {};
const pos = new THREE.Vector3(),
  vel = new THREE.Vector3(),
  omega = new THREE.Vector3(),
  quat = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const inertia = new THREE.Vector3(3.4, 6, 4.7);
function placeOnTrack(distance) {
  const { point, angle } = trackAt(distance);
  pos
    .copy(point)
    .add(
      new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0).multiplyScalar(
        0.33,
      ),
    );
  quat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
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
  ui.throttle.value = 50;
  auto = false;
  ui.auto.textContent = "ESTABILIZAÇÃO: OFF";
  ui.status.textContent = "Pronto para percorrer a rampa.";
  ui.status.style.color = "#9bdcff";
  camera.position.set(52, 31, 47);
  orbit.target.set(0, 23, 0);
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
document.querySelector("#launch").onclick = launch;
document.querySelector("#reset").onclick = reset;
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
addEventListener("keydown", (e) => {
  if (prevent.has(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === "KeyT") toggleAuto();
  if (e.code === "KeyR") reset();
  if (e.code === "Enter") launch();
});
addEventListener("keyup", (e) => {
  keys[e.code] = false;
});
addEventListener("blur", () => {
  for (const k in keys) keys[k] = false;
});
function axis(positive, negative) {
  return Number(!!keys[positive]) - Number(!!keys[negative]);
}
const worldAcceleration = new THREE.Vector3();

function desiredTorques() {
  // Manual input requests torque around the car's local axes.
  const command = {
    x: axis("KeyA", "KeyD") * 13,
    y: axis("KeyQ", "KeyE") * 9,
    z: axis("KeyW", "KeyS") * 15,
  };
  if (!auto) return command;

  // Quaternion error measures the shortest rotation back to upright.
  // Proportional correction turns the car; angular damping stops overshoot.
  const error = quat.clone().invert();
  if (error.w < 0) error.set(-error.x, -error.y, -error.z, -error.w);
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(error.w, -1, 1));
  const sinHalf = Math.sqrt(Math.max(1 - error.w * error.w, 0));
  const errorAxis =
    sinHalf > 0.0001
      ? new THREE.Vector3(error.x, error.y, error.z).divideScalar(sinHalf)
      : new THREE.Vector3(1, 0, 0);
  const localOmega = omega.clone().applyQuaternion(quat.clone().invert());
  command.x += THREE.MathUtils.clamp(
    errorAxis.x * angle * 17 - localOmega.x * 9,
    -32,
    32,
  );
  command.y += THREE.MathUtils.clamp(
    errorAxis.y * angle * 12 - localOmega.y * 7,
    -20,
    20,
  );
  command.z += THREE.MathUtils.clamp(
    errorAxis.z * angle * 18 - localOmega.z * 10,
    -36,
    36,
  );
  return command;
}

function automaticThrottle() {
  const upAlignment = new THREE.Vector3(0, 1, 0).applyQuaternion(quat).y;
  if (upAlignment <= 0.35) return 0;

  // Descend quickly when high, then slow down near the ground.
  const targetVy =
    pos.y > 12
      ? -5
      : -Math.max(1.5, Math.sqrt(Math.max(pos.y - 0.67, 0)) * 1.35);
  const desiredAy = THREE.MathUtils.clamp((targetVy - vel.y) * 2.8, -9, 18);
  return THREE.MathUtils.clamp(
    (9.81 + desiredAy) / (96 * upAlignment),
    0,
    0.65,
  );
}

function simulate(dt) {
  if (mode === "ready") return;
  if (mode === "ramp") {
    const previousY = pos.y;
    trackDistance = Math.min(trackDistance + dt * 23, trackLength);
    const angle = placeOnTrack(trackDistance);
    vel.set(23 * Math.cos(angle), (pos.y - previousY) / dt, 0);
    if (trackDistance >= trackLength) {
      mode = "flight";
      vel.set(0, 0, 0);
      omega.set(0, 0, 0);
      ui.status.textContent = auto
        ? "SAÍDA INVERTIDA! Estabilização ativa; descendo para a marca."
        : "SAÍDA INVERTIDA! Ative T para estabilizar e pousar na marca.";
    }
    return;
  }
  if (mode === "landed") return;
  const torqueCommand = desiredTorques();
  const totalAcceleration = new THREE.Vector3(0, -9.81, 0),
    torqueLocal = new THREE.Vector3();
  const xarm = 1.8,
    zarm = 1.08;
  const base =
    keys.ShiftLeft || keys.ShiftRight
      ? 1
      : auto
        ? automaticThrottle()
        : throttle;
  const strafe = axis("ArrowRight", "ArrowLeft") * 0.33;
  const forward = axis("ArrowUp", "ArrowDown") * 0.33;
  for (const t of thrusters) {
    // Differential upward thrust creates roll/pitch torque; limit for saturation.
    const power = THREE.MathUtils.clamp(
      base +
        (torqueCommand.x * -t.z) / (4 * zarm * zarm * 24) +
        (torqueCommand.z * t.x) / (4 * xarm * xarm * 24),
      0,
      1,
    );
    t.power = power;
    // Gimbal axes: tilt.z controls lateral nozzle tilt, tilt.x longitudinal.
    const targetZ = THREE.MathUtils.clamp(
      -strafe + torqueCommand.y * t.x * 0.018,
      -0.4,
      0.4,
    );
    const targetX = THREE.MathUtils.clamp(
      forward + torqueCommand.y * t.z * 0.018,
      -0.4,
      0.4,
    );
    t.tilt.rotation.z = THREE.MathUtils.damp(t.tilt.rotation.z, targetZ, 7, dt);
    t.tilt.rotation.x = THREE.MathUtils.damp(t.tilt.rotation.x, targetX, 7, dt);
    const reaction = new THREE.Vector3(0, 1, 0)
      .applyEuler(t.tilt.rotation)
      .multiplyScalar(power * 24); // acceleration
    worldAcceleration.copy(reaction).applyQuaternion(quat);
    totalAcceleration.add(worldAcceleration);
    torqueLocal.add(new THREE.Vector3(t.x, -0.1, t.z).cross(reaction));
    t.exhaust.visible = power > 0.025;
    t.exhaust.scale.y = 0.38 + power * 1.7;
    t.light.intensity = power * 5;
  }
  // Angular acceleration in local body principal axes; simple damping.
  const bodyOmega = omega.clone().applyQuaternion(quat.clone().invert());
  // The arcade stability controller supplements differential thrust while inverted.
  if (auto)
    torqueLocal.add(
      new THREE.Vector3(
        torqueCommand.x,
        torqueCommand.y,
        torqueCommand.z,
      ).multiplyScalar(0.8),
    );
  const alpha = new THREE.Vector3(
    torqueLocal.x / inertia.x,
    torqueLocal.y / inertia.y,
    torqueLocal.z / inertia.z,
  ).addScaledVector(bodyOmega, -2.1);
  omega.addScaledVector(alpha.applyQuaternion(quat), dt);
  omega.clampLength(0, 5.7);
  const speed = omega.length();
  if (speed > 1e-7) {
    const dq = new THREE.Quaternion().setFromAxisAngle(
      omega.clone().normalize(),
      speed * dt,
    );
    quat.premultiply(dq).normalize();
  }
  // Midday sun: keep the landing point directly under the ramp exit.
  if (auto) {
    totalAcceleration.x += THREE.MathUtils.clamp(
      (landingX - pos.x) * 5 - vel.x * 5,
      -24,
      24,
    );
    totalAcceleration.z += THREE.MathUtils.clamp(
      (landingZ - pos.z) * 5 - vel.z * 5,
      -24,
      24,
    );
  }
  vel.addScaledVector(totalAcceleration, dt);
  vel.multiplyScalar(Math.exp(-0.045 * dt));
  pos.addScaledVector(vel, dt);
  if (pos.y <= 0.67) {
    pos.y = 0.67;
    mode = "landed";
    vel.set(0, 0, 0);
    omega.set(0, 0, 0);
    const upright =
      new THREE.Vector3(0, 1, 0).applyQuaternion(quat).dot(UP) > 0.72;
    const landingError = Math.hypot(pos.x - landingX, pos.z - landingZ);
    ui.status.textContent = upright
      ? `POUSO CONCLUÍDO! ${landingError.toFixed(1)} m da marca. Reinicie para tentar novamente.`
      : "IMPACTO! O carro não estava estabilizado. Reinicie.";
    ui.status.style.color = upright ? "#87f5bb" : "#ff9e9e";
  }
  vehicle.position.copy(pos);
  vehicle.quaternion.copy(quat);
}
reset();
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
frame();
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
