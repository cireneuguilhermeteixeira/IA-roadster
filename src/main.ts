import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { createVisuals } from "./visuals";
import { VehiclePhysics, FIXED_DT } from "./physics";
import { FlightController } from "./controller";
import { EvolutionTrainer } from "./learning/trainer";
import { isLandingContact, neuralFlightInputs, releaseHeading } from "./learning/flight";
import { drawNetwork, drawHistory, drawQuality } from "./learning/visualize";
import { drawTrainingMap } from "./learning/map";
import { POPULATION } from "./learning/genetics";
import "./style.css";

// Create visible geometry once; training uses another physics world without 3D copies.
const view = createVisuals(document.querySelector<HTMLElement>("#viewport")!);
/** Shared scene objects and the physical ramp/target geometry returned by createVisuals. */
const {
  scene,
  camera,
  renderer,
  orbit,
  vehicle,
  thrusters,
  trackAt,
  trackLength,
  rampSurface,
  landingX,
  landingZ,
} = view;
/** Cached HUD controls and labels updated by the animation loop. */
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
/** Current keyboard state consumed on each fixed physics step. */
const keys: Record<string, boolean> = {};
const controller = new FlightController();
/** Manual and training physics are initialized only after Rapier WASM is ready. */
let physics: VehiclePhysics;
let trainer: EvolutionTrainer;
/** Display/control flags; neural and hand-coded assistance are mutually exclusive. */
let neuralPilot = false;
let hudFrame = 0;
/** Training buttons, diagnostics, and canvases in the side panel. */
const trainingButton = document.querySelector<HTMLButtonElement>("#train-toggle")!;
const pilotButton = document.querySelector<HTMLButtonElement>("#pilot-toggle")!;
const exportButton = document.querySelector<HTMLButtonElement>("#brain-export")!;
const importButton = document.querySelector<HTMLButtonElement>("#brain-import")!;
const importFile = document.querySelector<HTMLInputElement>("#brain-file")!;
const trainingStats = document.querySelector<HTMLElement>("#training-stats")!;
const trainingDiagnostics = document.querySelector<HTMLElement>("#training-diagnostics")!;
const trainingMap = document.querySelector<HTMLCanvasElement>("#training-map")!;
const brainCanvas = document.querySelector<HTMLCanvasElement>("#brain-canvas")!;
const historyCanvas = document.querySelector<HTMLCanvasElement>("#history-canvas")!;
const qualityCanvas = document.querySelector<HTMLCanvasElement>("#quality-canvas")!;
/** Manual car phase and time since its release from the upper ramp. */
let mode: "ready" | "ramp" | "flight" = "ready";
let flightSeconds = 0;
/** Manual stabilization, camera-follow choice, and per-motor throttle ceiling. */
let auto = true,
  follow = true,
  throttle = 1;
/** World-space target and heading held by the neural pilot after release. */
const landing = new THREE.Vector3(landingX, 0, landingZ);
let flightHeading = new THREE.Vector3(-1, 0, 0);
/** Pause training and return to the manual Three.js viewport. */
function stopTrainingDisplay() {
  if (!trainer?.running) return;
  trainer.pause();
  trainingMap.hidden = true;
  trainingButton.textContent = "INICIAR TREINO";
}
/** URL switch used for the no-thrust physics experiment. */
const reactorsEnabled = new URLSearchParams(location.search).get("reactors") !== "off";
const reactorNote = reactorsEnabled ? "" : " Reatores 100% desligados (teste).";
/** Reset manual physics, controls, camera, and visible status text. */
function reset() {
  stopTrainingDisplay();
  physics.reset();
  mode = "ready";
  flightSeconds = 0;
  flightHeading = new THREE.Vector3(-1, 0, 0);
  auto = reactorsEnabled && !neuralPilot;
  throttle = reactorsEnabled ? 1 : 0;
  ui.auto.textContent = `ESTABILIZAÇÃO: ${auto ? "ON" : "OFF"}`;
  ui.throttle.value = reactorsEnabled ? "100" : "0";
  ui.throttle.disabled = !reactorsEnabled;
  ui.status.textContent = "Pronto para acelerar na rampa." + reactorNote;
  const pos = physics.snapshot().position;
  orbit.target.copy(pos);
  camera.position.copy(pos).add(new THREE.Vector3(12, 7, 12));
}
/** Start a new manual run up the ramp. */
function launch() {
  stopTrainingDisplay();
  physics.reset();
  mode = "ramp";
  flightSeconds = 0;
  ui.status.textContent = "Acelerando na rampa..." + reactorNote;
}
document.querySelector<HTMLElement>("#launch")!.onclick = launch;
document.querySelector<HTMLElement>("#reset")!.onclick = reset;
// Switching the hand-coded stabilizer also disables the neural pilot.
ui.auto.onclick = () => {
  neuralPilot = false;
  pilotButton.textContent = "PILOTO NEURAL: OFF";
  auto = !auto;
  ui.auto.textContent = `ESTABILIZAÇÃO: ${auto ? "ON" : "OFF"}`;
};
ui.camera.onclick = () => {
  follow = !follow;
  ui.camera.textContent = `CÂMERA: ${follow ? "SEGUIR" : "LIVRE"}`;
};
ui.throttle.oninput = () => {
  throttle = Number(ui.throttle.value) / 100;
  if (mode === "flight" && !physics.grounded) {
    ui.status.textContent =
      throttle === 0
        ? "Queda livre: reatores desligados."
        : "Reatores ativos. Controle a descida e a direção.";
  }
};
// Prevent browser scrolling while game-control keys are held.
const prevent = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
// Track held keys and route single-press shortcuts through the same UI actions.
addEventListener("keydown", (event: KeyboardEvent) => {
  if (prevent.has(event.code)) event.preventDefault();
  keys[event.code] = true;
  if (event.repeat) return;
  if (event.code === "KeyT") ui.auto.click();
  if (event.code === "KeyR") reset();
  if (event.code === "Enter") launch();
});
addEventListener("keyup", (event: KeyboardEvent) => (keys[event.code] = false));
addEventListener("blur", () => Object.keys(keys).forEach((key) => (keys[key] = false)));
// Training runs in its own Rapier world; the manual car is paused while it runs.
trainingButton.onclick = () => {
  if (trainer.running) stopTrainingDisplay();
  else {
    trainingMap.hidden = false;
    trainer.start();
  }
  trainingButton.textContent = trainer.running ? "PAUSAR TREINO" : "INICIAR TREINO";
};
// Activate the saved champion only when a compatible one exists.
pilotButton.onclick = () => {
  if (!trainer.champion) {
    ui.status.textContent = "Treine ao menos uma geração antes de ativar o piloto neural.";
    return;
  }
  neuralPilot = !neuralPilot;
  auto = false;
  ui.auto.textContent = "ESTABILIZAÇÃO: OFF";
  pilotButton.textContent = `PILOTO NEURAL: ${neuralPilot ? "ON" : "OFF"}`;
};
// JSON export/import moves a checkpoint between browsers or sessions.
exportButton.onclick = () => {
  if (trainer.champion && Number.isFinite(trainer.bestFitness)) trainer.exportJSON();
  else ui.status.textContent = "Aguarde uma geração para pontuar o DNA com as regras atuais.";
};
importButton.onclick = () => importFile.click();
// Imported JSON is checked by EvolutionTrainer before replacing its candidates.
importFile.onchange = async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  try {
    trainer.importJSON(await file.text());
    ui.status.textContent = trainer.champion
      ? "Cérebro importado com sucesso."
      : "DNA antigo será testado como um indivíduo; o treino começa com pontuação nova.";
  } catch (error) {
    ui.status.textContent = "Erro ao importar cérebro: " + String(error);
  }
  importFile.value = "";
};
/** Wall-clock timing and fixed-step remainder for the manual simulation. */
const clock = new THREE.Clock();
let accumulator = 0;
/** Render-loop callback: advance manual physics, draw the training map, and refresh HUD. */
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (trainer.running) accumulator = 0;
  else accumulator += dt;
  while (accumulator >= FIXED_DT) {
    if (mode !== "ready") {
      const flightState = mode === "flight" ? physics.snapshot() : null;
      // Only the active controller supplies a command for this physical step.
      let controls = flightState
        ? controller.command(flightState, keys, auto, throttle, landing)
        : undefined;
      if (flightState && neuralPilot && trainer.champion) {
        controls = neuralFlightInputs(
          trainer.champion,
          flightState,
          landing,
          flightHeading,
          flightSeconds,
          isLandingContact(flightState, landing, physics.contactSurface()),
          throttle,
        ).controls;
      }
      physics.step(FIXED_DT, controls);
      if (mode === "flight") flightSeconds += FIXED_DT;
      if (mode === "ramp" && physics.flying) {
        mode = "flight";
        flightHeading = releaseHeading(physics.snapshot());
        ui.status.textContent = reactorsEnabled
          ? "LIBERADO! Controle os propulsores para estabilizar."
          : "LIBERADO! Queda balística com os reatores desligados.";
      }
      if (mode === "flight" && physics.grounded)
        ui.status.textContent =
          physics.contactSurface() === "ramp" ? "Carro parado na rampa." : "Carro no solo.";
    }
    accumulator -= FIXED_DT;
  }
  const state = physics.snapshot();
  vehicle.position.copy(state.position);
  vehicle.quaternion.copy(state.rotation);
  // The canvas replays recorded flights; it does not create 96 Rapier bodies.
  if (trainer.running) {
    drawTrainingMap(trainingMap, {
      replays: trainer.replays,
      generation: trainer.displayGeneration,
      nextGeneration: trainer.generation,
      individual: trainer.index,
      seconds: trainer.displaySeconds,
      displaying: trainer.displaying,
      trackAt,
      trackLength,
      landing,
    });
  }
  const inclination = THREE.MathUtils.radToDeg(
    Math.acos(
      THREE.MathUtils.clamp(new THREE.Vector3(0, 1, 0).applyQuaternion(state.rotation).y, -1, 1),
    ),
  );
  ui.alt.textContent = `${Math.max(0, state.position.y).toFixed(1)} m`;
  ui.att.textContent = `${inclination.toFixed(0)}°`;
  ui.speed.textContent = `${state.velocity.y.toFixed(1)} m/s`;
  ui.percent.textContent = `${Math.round(throttle * 100)}%`;
  ui.throttleValue.textContent = ui.percent.textContent;
  ui.power.style.width = ui.percent.textContent;
  if (follow) {
    const shift = state.position.clone().sub(orbit.target);
    camera.position.add(shift);
    orbit.target.copy(state.position);
  }
  orbit.update();
  // Skip costly WebGL scene rendering while fast isolated training is active.
  if (!trainer.running) renderer.render(scene, camera);
  if (hudFrame++ % 8 === 0) {
    // Refresh charts less often than the animation loop to reduce DOM/canvas work.
    const lastGeneration = trainer.history.at(-1);
    const diagnostics = lastGeneration?.diagnostics;
    const percent = (rate: number) => `${(rate * 100).toFixed(0)}%`;
    const optionalPercent = (rate: number | null | undefined) =>
      rate == null || !Number.isFinite(rate) ? "—" : percent(rate);
    const number = (value: number | null | undefined, unit: string) =>
      value == null || !Number.isFinite(value)
        ? "—"
        : `${value.toFixed(1)}${unit ? ` ${unit}` : ""}`;
    const trainingPhase = trainer.displaying
      ? `GERAÇÃO ${trainer.displayGeneration} · REPRODUZINDO 96 VOOS`
      : `GERAÇÃO ${trainer.generation} · INDIVÍDUO ${Math.min(trainer.index + 1, POPULATION)}/${POPULATION}`;
    trainingStats.textContent = `${trainingPhase} · RECORDE ${Number.isFinite(trainer.bestFitness) ? trainer.bestFitness.toFixed(1) : "—"} · RAMPA ${diagnostics ? percent(diagnostics.rampRate) : "—"} · EPISÓDIOS ${trainer.episodes} · SIMULAÇÃO ${trainer.simulationSpeed.toFixed(1)}×`;
    if (diagnostics) {
      const recent = trainer.history
        .slice(-20)
        .map((record) => record.diagnostics?.stableRampRate)
        .filter((rate): rate is number => rate !== undefined);
      const stableRecent = recent.length
        ? recent.reduce((sum, value) => sum + value, 0) / recent.length
        : null;
      const best = diagnostics.best;
      const surface =
        best.surface === "ground" ? "solo" : best.surface === "ramp" ? "rampa" : "sem contato";
      const motorPower = best.motorPower?.map(percent).join(" / ") ?? "—";
      trainingDiagnostics.textContent = `GERAÇÃO ${lastGeneration.generation} · 96 redes · 2 voos cada\nSem recorde de fitness ou freio: ${trainer.stagnantGenerations} gerações${trainer.stagnantGenerations >= 15 ? " · busca local e exploração" : ""}\nMétricas da saída normal:\nPrimeiro contato: rampa ${percent(diagnostics.rampRate)} · solo ${percent(diagnostics.groundRate)} · alvo na rampa ${percent(diagnostics.nearRate)} · pouso controlado ${percent(diagnostics.controlledRate)}\nPermanência estável na rampa: ${optionalPercent(diagnostics.stableRampRate)} · média das últimas ${recent.length} gerações ${optionalPercent(stableRecent)}\nContato detectado: ${percent(lastGeneration.successRate)}\nEntre os contatos no alvo: descida ≤3 m/s ${optionalPercent(diagnostics.nearVerticalRate)} · horizontal ≤4 m/s ${optionalPercent(diagnostics.nearHorizontalRate)} · em pé ${optionalPercent(diagnostics.nearUprightRate)} · frente correta ${optionalPercent(diagnostics.nearFacingRate)} · até 1 giro ${optionalPercent(diagnostics.nearSpinRate)}\nMédia na rampa: erro ${number(diagnostics.meanDistance, "m")} · descida ${number(diagnostics.meanVerticalSpeed, "m/s")} · horizontal ${number(diagnostics.meanHorizontalSpeed, "m/s")} · em pé ${number(diagnostics.meanUpright, "")} · frente ${number(diagnostics.meanFacing, "")}\nFreio: qualidade média ${optionalPercent(diagnostics.meanBrakingScore)} · especialista ${number(diagnostics.bestBraking?.verticalSpeed, "m/s")} vertical · ${number(diagnostics.bestBraking?.horizontalSpeed, "m/s")} horizontal · erro ${number(diagnostics.bestBraking?.distance, "m")}\nControles médios: diferença entre motores ${optionalPercent(diagnostics.meanPowerSpread)} · bicos ${number(diagnostics.meanNozzleTilt, "°")} · orientação no voo ${number(diagnostics.meanFlightUpright, "")} · descida controlada ${optionalPercent(diagnostics.meanControlledDescent)}\nGiros médios (todos): ${number(diagnostics.meanTurns, "")}\nMelhor episódio: ${surface} · erro ${number(best.distance, "m")} · descida ${number(best.verticalSpeed, "m/s")} · horizontal ${number(best.horizontalSpeed, "m/s")} · em pé ${number(best.upright, "")} · frente ${number(best.facing, "")} · giros ${number(best.turns, "")} · giro no toque ${number(best.impactAngularSpeed, "rad/s")}\nApós o contato do melhor: superfície ${best.finalSurface === "ramp" ? "rampa" : best.finalSurface === "ground" ? "solo" : "sem contato"} · erro ${number(best.finalDistance, "m")} · descida ${number(best.finalVerticalSpeed, "m/s")} · horizontal ${number(best.finalHorizontalSpeed, "m/s")} · em pé ${number(best.finalUpright, "")} · frente ${number(best.finalFacing, "")} · giro ${number(best.finalAngularSpeed, "rad/s")} · em pé no período ${number(best.postContactUpright, "")} · giro médio ${number(best.postContactAngularSpeed, "rad/s")}\nMotores do melhor: ${motorPower} · diferença ${optionalPercent(best.powerSpread)} · bicos ${number(best.nozzleTilt, "°")}`;
      trainingDiagnostics.textContent += `\nAproximação: qualidade média ${optionalPercent(diagnostics.meanApproachQuality)} · melhor ${optionalPercent(best.approachQuality)} · espera perto do solo ${number(best.nearGroundHoverSeconds, "s")}\nPrimeiro toque do melhor: altura ${number(best.contactHeight, "m")}\nApós o toque do melhor: frente média ${number(best.postContactFacing, "")} · horizontal média ${number(best.postContactHorizontalSpeed, "m/s")} · menor posição em pé ${number(best.postContactMinUpright, "")} · tempo em contato com a rampa ${optionalPercent(best.postContactRampFraction)} · potência média dos motores ${optionalPercent(best.postContactMotorPower)}`;
    } else trainingDiagnostics.textContent = "Aguardando métricas da primeira geração...";
    if (trainer.currentTrace) drawNetwork(brainCanvas, trainer.currentTrace);
    drawHistory(historyCanvas, trainer.history);
    drawQuality(qualityCanvas, trainer.history);
  }
}
// Rapier's WASM module must initialize before either physics world is built.
(async () => {
  await RAPIER.init();
  physics = new VehiclePhysics(rampSurface, trackAt, trackLength, thrusters, reactorsEnabled);
  trainer = new EvolutionTrainer(rampSurface, trackAt, trackLength, landing);
  reset();
  frame();
})().catch((error) => {
  console.error(error);
  ui.status.textContent = "Erro inicializando a física: " + error;
});
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
