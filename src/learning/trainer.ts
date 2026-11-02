import * as THREE from "three";
import {
  VehiclePhysics,
  FIXED_DT,
  THRUSTER_X,
  THRUSTER_Z,
  type State,
  type ThrusterVisual,
} from "../physics";
import {
  migrateLegacyBiasSensor,
  randomGenome,
  SHAPE,
  WEIGHT_COUNT,
  type Genome,
  type Trace,
} from "./network";
import {
  brakingScore,
  breed,
  landingSpeedQuality,
  loadCheckpoint,
  saveCheckpoint,
  POPULATION,
  type Checkpoint,
  type EpisodeMetrics,
  type GenerationRecord,
  type Individual,
} from "./genetics";
import { isLandingContact, neuralFlightInputs, releaseHeading } from "./flight";

const MAX_SECONDS = 8;
const POST_CONTACT_SECONDS = 1.5;
const TRAINING_BATCH_MS = 10;
const MAX_STEPS_PER_BATCH = 512;
const RESUME_MUTANTS = Math.floor(POPULATION / 4);
const TARGET_RADIUS = 5;
const GENTLE_VERTICAL_SPEED = 3;
const GENTLE_HORIZONTAL_SPEED = 4;
function validGenome(genome: Genome | undefined): genome is Genome {
  return genome?.length === WEIGHT_COUNT && genome.every(Number.isFinite);
}
function seedPopulation(seed: Genome, alternate?: Genome): Genome[] {
  const genomes = Array.from({ length: POPULATION }, () => randomGenome());
  genomes[0] = seed.slice();
  if (alternate) genomes[1] = alternate.slice();
  for (let i = 1; i < RESUME_MUTANTS; i++) {
    if (i === 1 && alternate) continue;
    const source = alternate && i % 2 === 1 ? alternate : seed;
    genomes[i] = source.map((weight) =>
      THREE.MathUtils.clamp(
        weight + (Math.random() < 0.025 ? (Math.random() * 2 - 1) * 0.16 : 0),
        -4,
        4,
      ),
    );
  }
  return genomes;
}
function previousGenome(checkpoint: Checkpoint): Genome {
  return checkpoint.scoreVersion === undefined || checkpoint.scoreVersion < 12
    ? migrateLegacyBiasSensor(checkpoint.champion)
    : checkpoint.champion.slice();
}
function dummyThrusters(): ThrusterVisual[] {
  return [-THRUSTER_X, THRUSTER_X].flatMap((x) =>
    [-THRUSTER_Z, THRUSTER_Z].map((z) => ({
      x,
      z,
      power: 0,
      tilt: new THREE.Group(),
      yaw: new THREE.Group(),
      exhaust: new THREE.Mesh(),
      light: new THREE.PointLight(),
    })),
  );
}
export type FlightFrame = { x: number; y: number; z: number; angle: number; upright: number };
export type FlightReplay = { index: number; frames: FlightFrame[]; metrics: EpisodeMetrics };
const REPLAY_SAMPLE_STEPS = 4;
export class EvolutionTrainer {
  readonly physics: VehiclePhysics;
  private readonly thrusters: ThrusterVisual[];
  readonly history: GenerationRecord[] = [];
  generation = 1;
  index = 0;
  running = false;
  phase: "seed" | "episode" | "stopped" = "seed";
  bestFitness = -Infinity;
  champion: Genome | null = null;
  bestBrakingScore = -Infinity;
  brakingChampion: Genome | null = null;
  stagnantGenerations = 0;
  currentTrace: Trace | null = null;
  episodeSeconds = 0;
  episodes = 0;
  simulationSpeed = 0;
  readonly replays: FlightReplay[] = [];
  displayGeneration = 0;
  displaying = false;
  private displayStart = 0;
  private episodeFrames: FlightFrame[] = [];
  private episodeSteps = 0;
  private desiredHeading = new THREE.Vector3(-1, 0, 0);
  private workTimer: number | null = null;
  private speedSampleStart = 0;
  private speedSampleSteps = 0;
  private savedSeed: State | null = null;
  private scenarios: State[] = [];
  private scenarioIndex = 0;
  private scenarioFitness = 0;
  private scenarioBrakingScore = 0;
  private nominalMetrics: EpisodeMetrics | null = null;
  private nominalSuccess = false;
  private genomes: Genome[] = Array.from({ length: POPULATION }, () => randomGenome());
  private results: Individual[] = [];
  private rotationRadians = 0;
  private firstContact: Omit<EpisodeMetrics, "turns" | "contacted"> | null = null;
  private contactAt = 0;
  private powerSums = [0, 0, 0, 0];
  private powerSpreadSum = 0;
  private nozzleTiltSum = 0;
  private flightUprightSum = 0;
  private controlledDescentSum = 0;
  private flightSamples = 0;
  private approachQualitySum = 0;
  private approachSamples = 0;
  private nearGroundHoverSeconds = 0;
  private postContactUprightSum = 0;
  private postContactMinUpright = 1;
  private postContactFacingSum = 0;
  private postContactHorizontalSpeedSum = 0;
  private postContactAngularSpeedSum = 0;
  private postContactMotorPowerSum = 0;
  private postContactRampSamples = 0;
  private postContactSamples = 0;
  constructor(
    ramp: THREE.Mesh,
    trackAt: (distance: number) => { point: THREE.Vector3; angle: number },
    trackLength: number,
    private landing: THREE.Vector3,
  ) {
    this.thrusters = dummyThrusters();
    this.physics = new VehiclePhysics(ramp, trackAt, trackLength, this.thrusters, true);
    const checkpoint = loadCheckpoint();
    if (checkpoint) {
      if (checkpoint.scoreVersion === 17) {
        this.generation = checkpoint.generation + 1;
        this.champion = checkpoint.champion.slice();
        this.bestFitness = checkpoint.bestFitness;
        this.brakingChampion = validGenome(checkpoint.brakingChampion)
          ? checkpoint.brakingChampion.slice()
          : null;
        this.bestBrakingScore = checkpoint.bestBrakingScore ?? -Infinity;
        this.stagnantGenerations = checkpoint.stagnantGenerations ?? 0;
        this.history.push(...checkpoint.history.slice(-200));
        this.genomes = seedPopulation(this.champion, this.brakingChampion ?? undefined);
      } else {
        // Re-score the previous champion and nearby variants under the new reward.
        this.genomes = seedPopulation(
          previousGenome(checkpoint),
          validGenome(checkpoint.brakingChampion) ? checkpoint.brakingChampion : undefined,
        );
      }
    }
  }
  start() {
    if (this.running) return;
    this.running = true;
    if (this.displaying) this.displayStart = performance.now();
    this.speedSampleStart = performance.now();
    this.speedSampleSteps = 0;
    this.scheduleWork();
  }
  pause() {
    this.running = false;
    if (this.workTimer !== null) clearTimeout(this.workTimer);
    this.workTimer = null;
    this.simulationSpeed = 0;
  }
  private scheduleWork() {
    this.workTimer = window.setTimeout(
      () => {
        this.workTimer = null;
        if (!this.running) return;
        this.tick();
        this.scheduleWork();
      },
      this.displaying ? 16 : 0,
    );
  }
  get progress() {
    return this.index / POPULATION;
  }
  get displaySeconds() {
    return this.displaying ? Math.min(MAX_SECONDS, (performance.now() - this.displayStart) / 1000) : 0;
  }
  private recordFrame(state: State) {
    const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(state.rotation);
    this.episodeFrames.push({
      x: state.position.x,
      y: state.position.y,
      z: state.position.z,
      angle: Math.atan2(forward.y, forward.x),
      upright: new THREE.Vector3(0, 1, 0).applyQuaternion(state.rotation).y,
    });
  }
  private startEpisode() {
    if (!this.savedSeed) return;
    if (!this.scenarios.length) {
      const seed = this.savedSeed;
      // Fixed nominal and perturbed releases make fitness comparable across generations.
      this.scenarios = [
        seed,
        {
          position: seed.position.clone().add(new THREE.Vector3(0.5, 0.2, 0.5)),
          rotation: seed.rotation
            .clone()
            .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.06, -0.04, 0.09))),
          velocity: seed.velocity.clone().add(new THREE.Vector3(0.7, -0.4, 0.5)),
          angularVelocity: seed.angularVelocity.clone().add(new THREE.Vector3(0.15, -0.1, 0.15)),
        },
      ];
    }
    this.physics.primeFlight(this.scenarios[this.scenarioIndex]);
    this.episodeFrames = [];
    this.episodeSteps = 0;
    if (this.scenarioIndex === 0) this.recordFrame(this.physics.snapshot());
    this.episodeSeconds = 0;
    this.rotationRadians = 0;
    this.firstContact = null;
    this.contactAt = 0;
    this.powerSums.fill(0);
    this.powerSpreadSum = 0;
    this.nozzleTiltSum = 0;
    this.flightUprightSum = 0;
    this.controlledDescentSum = 0;
    this.flightSamples = 0;
    this.approachQualitySum = 0;
    this.approachSamples = 0;
    this.nearGroundHoverSeconds = 0;
    this.postContactUprightSum = 0;
    this.postContactMinUpright = 1;
    this.postContactFacingSum = 0;
    this.postContactHorizontalSpeedSum = 0;
    this.postContactAngularSpeedSum = 0;
    this.postContactMotorPowerSum = 0;
    this.postContactRampSamples = 0;
    this.postContactSamples = 0;
  }
  /** Use spare main-thread time in bounded batches so rendering and input can still run. */
  private tick() {
    if (!this.running) return;
    if (this.displaying) {
      if (this.displaySeconds < MAX_SECONDS) return;
      this.displaying = false;
      this.replays.length = 0;
      this.speedSampleStart = performance.now();
      this.speedSampleSteps = 0;
    }
    const batchStart = performance.now();
    let steps = 0;
    while (
      steps < MAX_STEPS_PER_BATCH &&
      !this.displaying &&
      (steps === 0 || performance.now() - batchStart < TRAINING_BATCH_MS)
    ) {
      steps++;
      if (this.phase === "seed") {
        this.physics.step(FIXED_DT);
        if (this.physics.flying) {
          this.savedSeed = this.physics.snapshot();
          this.phase = "episode";
          this.desiredHeading = releaseHeading(this.savedSeed);
          this.startEpisode();
        }
        continue;
      }
      if (this.phase !== "episode") return;
      const state = this.physics.snapshot();
      const genome = this.genomes[this.index];
      const { controls, trace } = neuralFlightInputs(
        genome,
        state,
        this.landing,
        this.desiredHeading,
        this.episodeSeconds,
        isLandingContact(state, this.landing, this.physics.contactSurface()),
      );
      this.currentTrace = trace;
      this.rotationRadians += state.angularVelocity.length() * FIXED_DT;
      this.physics.step(FIXED_DT, controls);
      this.episodeSeconds += FIXED_DT;
      const finalState = this.physics.snapshot();
      if (this.scenarioIndex === 0 && ++this.episodeSteps % REPLAY_SAMPLE_STEPS === 0)
        this.recordFrame(finalState);
      const surface = this.physics.contactSurface();
      if (!this.firstContact) {
        const powers = this.thrusters.map((thruster, index) => {
          this.powerSums[index] += thruster.power;
          this.nozzleTiltSum += Math.hypot(thruster.tilt.rotation.x, thruster.tilt.rotation.z);
          return thruster.power;
        });
        this.powerSpreadSum += Math.max(...powers) - Math.min(...powers);
        const rotation = finalState.rotation;
        const flightUpright = 1 - 2 * (rotation.x ** 2 + rotation.z ** 2);
        this.flightUprightSum += flightUpright;
        this.controlledDescentSum +=
          THREE.MathUtils.clamp((flightUpright + 1) / 2, 0, 1) *
          Math.exp(-Math.max(0, -finalState.velocity.y - GENTLE_VERTICAL_SPEED) / 6);
        this.flightSamples++;
        const planar = Math.hypot(
          finalState.position.x - this.landing.x,
          finalState.position.z - this.landing.z,
        );
        const height = finalState.position.y - this.landing.y;
        if (height >= 0 && height <= 6 && planar <= 12 && finalState.velocity.y > -0.2)
          this.nearGroundHoverSeconds += FIXED_DT;
        if (height >= 0 && height <= 12 && planar <= 12) {
          const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation);
          const upright = THREE.MathUtils.clamp((flightUpright + 1) / 2, 0, 1);
          const facing = THREE.MathUtils.clamp((1 + forward.dot(this.desiredHeading)) / 2, 0, 1);
          const descent = Math.max(0, -finalState.velocity.y);
          const horizontal = Math.hypot(finalState.velocity.x, finalState.velocity.z);
          const speed =
            0.6 * Math.exp(-Math.max(0, descent - GENTLE_VERTICAL_SPEED) / 6) +
            0.4 * Math.exp(-Math.max(0, horizontal - GENTLE_HORIZONTAL_SPEED) / 6);
          this.approachQualitySum +=
            (0.4 * speed +
              0.25 * upright +
              0.2 * facing +
              0.15 * Math.exp(-finalState.angularVelocity.length())) *
            Math.exp(-planar / 20);
          this.approachSamples++;
        }
        if (isLandingContact(finalState, this.landing, surface)) {
          this.contactAt = this.episodeSeconds;
          const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(state.rotation);
          this.firstContact = {
            surface,
            contactHeight: finalState.position.y,
            distance: Math.hypot(
              finalState.position.x - this.landing.x,
              finalState.position.z - this.landing.z,
            ),
            verticalSpeed: Math.abs(state.velocity.y),
            horizontalSpeed: Math.hypot(state.velocity.x, state.velocity.z),
            impactAngularSpeed: state.angularVelocity.length(),
            upright: new THREE.Vector3(0, 1, 0).applyQuaternion(state.rotation).y,
            facing: forward.dot(this.desiredHeading),
          };
        }
      }
      if (this.firstContact) {
        const postContactUpright = new THREE.Vector3(0, 1, 0).applyQuaternion(
          finalState.rotation,
        ).y;
        const postContactForward = new THREE.Vector3(1, 0, 0).applyQuaternion(finalState.rotation);
        this.postContactUprightSum += postContactUpright;
        this.postContactMinUpright = Math.min(this.postContactMinUpright, postContactUpright);
        this.postContactFacingSum += postContactForward.dot(this.desiredHeading);
        this.postContactHorizontalSpeedSum += Math.hypot(
          finalState.velocity.x,
          finalState.velocity.z,
        );
        this.postContactAngularSpeedSum += finalState.angularVelocity.length();
        this.postContactMotorPowerSum +=
          this.thrusters.reduce((sum, thruster) => sum + thruster.power, 0) / 4;
        if (surface === "ramp") this.postContactRampSamples++;
        this.postContactSamples++;
      }
      if (
        (this.firstContact && this.episodeSeconds - this.contactAt >= POST_CONTACT_SECONDS) ||
        finalState.position.y < -3 ||
        this.episodeSeconds >= MAX_SECONDS
      ) {
        const success = this.firstContact !== null;
        const finalForward = new THREE.Vector3(1, 0, 0).applyQuaternion(finalState.rotation);
        const metrics: EpisodeMetrics = {
          surface: this.firstContact?.surface ?? null,
          distance: this.firstContact?.distance ?? null,
          contactHeight: this.firstContact?.contactHeight ?? null,
          verticalSpeed: this.firstContact?.verticalSpeed ?? null,
          horizontalSpeed: this.firstContact?.horizontalSpeed ?? null,
          impactAngularSpeed: this.firstContact?.impactAngularSpeed ?? null,
          upright: this.firstContact?.upright ?? null,
          facing: this.firstContact?.facing ?? null,
          turns: this.rotationRadians / (2 * Math.PI),
          contacted: success,
          finalSurface: this.physics.contactSurface(),
          finalDistance: Math.hypot(
            finalState.position.x - this.landing.x,
            finalState.position.z - this.landing.z,
          ),
          finalVerticalSpeed: Math.abs(finalState.velocity.y),
          finalHorizontalSpeed: Math.hypot(finalState.velocity.x, finalState.velocity.z),
          finalUpright: new THREE.Vector3(0, 1, 0).applyQuaternion(finalState.rotation).y,
          finalFacing: finalForward.dot(this.desiredHeading),
          finalAngularSpeed: finalState.angularVelocity.length(),
          motorPower: this.powerSums.map((sum) => sum / Math.max(1, this.flightSamples)),
          powerSpread: this.powerSpreadSum / Math.max(1, this.flightSamples),
          nozzleTilt: (this.nozzleTiltSum / Math.max(1, this.flightSamples * 4)) * (180 / Math.PI),
          flightUpright: this.flightUprightSum / Math.max(1, this.flightSamples),
          controlledDescent: this.controlledDescentSum / Math.max(1, this.flightSamples),
          approachQuality: this.approachQualitySum / Math.max(1, this.approachSamples),
          nearGroundHoverSeconds: this.nearGroundHoverSeconds,
          postContactUpright: this.postContactUprightSum / Math.max(1, this.postContactSamples),
          postContactMinUpright: this.postContactMinUpright,
          postContactFacing: this.postContactFacingSum / Math.max(1, this.postContactSamples),
          postContactHorizontalSpeed:
            this.postContactHorizontalSpeedSum / Math.max(1, this.postContactSamples),
          postContactAngularSpeed:
            this.postContactAngularSpeedSum / Math.max(1, this.postContactSamples),
          postContactMotorPower:
            this.postContactMotorPowerSum / Math.max(1, this.postContactSamples),
          postContactRampFraction:
            this.postContactRampSamples / Math.max(1, this.postContactSamples),
        };
        const reward = this.fitness(finalState, metrics);
        this.episodes++;
        this.scenarioFitness += reward;
        this.scenarioBrakingScore += brakingScore(metrics);
        if (this.scenarioIndex === 0) {
          this.recordFrame(finalState);
          this.replays.push({ index: this.index, frames: this.episodeFrames, metrics });
          this.nominalMetrics = metrics;
          this.nominalSuccess = success;
        }
        if (++this.scenarioIndex === this.scenarios.length) {
          this.results.push({
            genome: genome.slice(),
            fitness: this.scenarioFitness / this.scenarios.length,
            brakingScore: this.scenarioBrakingScore / this.scenarios.length,
            success: this.nominalSuccess,
            metrics: this.nominalMetrics!,
          });
          this.scenarioIndex = 0;
          this.scenarioFitness = 0;
          this.scenarioBrakingScore = 0;
          this.nominalMetrics = null;
          this.index++;
          if (this.index >= POPULATION) this.nextGeneration();
        }
        this.startEpisode();
      }
    }
    this.speedSampleSteps += steps;
    const now = performance.now();
    if (now - this.speedSampleStart >= 1000) {
      this.simulationSpeed =
        (this.speedSampleSteps * FIXED_DT * 1000) / (now - this.speedSampleStart);
      this.speedSampleStart = now;
      this.speedSampleSteps = 0;
    }
  }
  private fitness(state: State, metrics: EpisodeMetrics) {
    const aligned = (value: number | null | undefined) =>
      THREE.MathUtils.clamp(((value ?? -1) + 1) / 2, 0, 1);
    const approach =
      900 * (metrics.approachQuality ?? 0) -
      500 * (metrics.nearGroundHoverSeconds ?? 0) -
      350 * Math.min(5, metrics.turns);
    if (metrics.surface !== "ramp") {
      const distance = Math.hypot(
        state.position.x - this.landing.x,
        state.position.z - this.landing.z,
      );
      return approach + 300 * Math.exp(-distance / 10) - 1500;
    }

    const impact =
      700 * Math.exp(-(metrics.distance ?? 100) / TARGET_RADIUS) +
      1700 *
        landingSpeedQuality(
          metrics.verticalSpeed ?? Infinity,
          metrics.horizontalSpeed ?? Infinity,
        ) +
      750 * aligned(metrics.upright) +
      750 * aligned(metrics.facing) +
      500 * Math.exp(-(metrics.impactAngularSpeed ?? 10) / 1.5);
    // A ramp touch that becomes a takeoff is a failed landing.
    if (metrics.finalSurface !== "ramp") return approach + impact - 3000;

    const settled =
      700 * Math.exp(-(metrics.finalDistance ?? 100) / TARGET_RADIUS) +
      700 * aligned(metrics.finalUpright) +
      700 * aligned(metrics.finalFacing) +
      1000 * aligned(metrics.postContactUpright) +
      800 * aligned(metrics.postContactMinUpright) +
      800 * aligned(metrics.postContactFacing) +
      900 * Math.exp(-(metrics.postContactHorizontalSpeed ?? 20) / 4) +
      700 * Math.exp(-(metrics.postContactAngularSpeed ?? 10)) +
      700 * (metrics.postContactRampFraction ?? 0);
    const score = approach + impact + settled + (this.stableRampLanding(metrics) ? 2000 : 0);
    return Number.isFinite(score) ? score : -1e6;
  }
  private stableRampLanding(metrics: EpisodeMetrics) {
    return (
      metrics.surface === "ramp" &&
      metrics.finalSurface === "ramp" &&
      (metrics.finalDistance ?? Infinity) <= TARGET_RADIUS &&
      (metrics.finalVerticalSpeed ?? Infinity) <= 1 &&
      (metrics.finalHorizontalSpeed ?? Infinity) <= GENTLE_HORIZONTAL_SPEED &&
      (metrics.finalUpright ?? -1) >= 0.8 &&
      (metrics.finalFacing ?? -1) >= 0.5 &&
      (metrics.finalAngularSpeed ?? Infinity) <= 0.75 &&
      (metrics.postContactUpright ?? -1) >= 0.8 &&
      (metrics.postContactMinUpright ?? -1) >= 0.5 &&
      (metrics.postContactFacing ?? -1) >= 0.5 &&
      (metrics.postContactHorizontalSpeed ?? Infinity) <= GENTLE_HORIZONTAL_SPEED &&
      (metrics.postContactAngularSpeed ?? Infinity) <= 0.75 &&
      (metrics.postContactRampFraction ?? 0) >= 0.8
    );
  }
  private nextGeneration() {
    this.displayGeneration = this.generation;
    this.displaying = true;
    this.displayStart = performance.now();
    this.simulationSpeed = 0;
    this.results.sort((a, b) => b.fitness - a.fitness);
    const best = this.results[0];
    const mean = this.results.reduce((s, r) => s + r.fitness, 0) / POPULATION;
    const successRate = this.results.filter((r) => r.success).length / POPULATION;
    const groundContacts = this.results.filter((r) => r.metrics.surface === "ground");
    const rampContacts = this.results.filter((r) => r.metrics.surface === "ramp");
    const near = rampContacts.filter((r) => r.metrics.distance! <= TARGET_RADIUS);
    const controlled = near.filter(
      (r) =>
        r.metrics.verticalSpeed! <= GENTLE_VERTICAL_SPEED &&
        r.metrics.horizontalSpeed! <= GENTLE_HORIZONTAL_SPEED &&
        r.metrics.upright! >= 0.8 &&
        r.metrics.facing! >= 0.5 &&
        r.metrics.turns <= 1 &&
        this.stableRampLanding(r.metrics),
    );
    const stableRamp = rampContacts.filter((r) => this.stableRampLanding(r.metrics));
    const bestBraking = this.results.reduce((best, candidate) =>
      candidate.brakingScore > best.brakingScore ? candidate : best,
    );
    const average = (values: number[]) =>
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const nearRate = (predicate: (metrics: EpisodeMetrics) => boolean) =>
      near.length ? near.filter((r) => predicate(r.metrics)).length / near.length : null;
    const fitnessImproved = best.fitness > this.bestFitness || !this.champion;
    const brakingImproved = bestBraking.brakingScore > this.bestBrakingScore;
    if (fitnessImproved) {
      this.bestFitness = best.fitness;
      this.champion = best.genome.slice();
    }
    if (brakingImproved) {
      this.bestBrakingScore = bestBraking.brakingScore;
      this.brakingChampion = bestBraking.genome.slice();
    }
    this.stagnantGenerations =
      fitnessImproved || brakingImproved ? 0 : this.stagnantGenerations + 1;
    this.history.push({
      generation: this.generation,
      best: best.fitness,
      mean,
      successRate,
      bestEver: this.bestFitness,
      diagnostics: {
        groundRate: groundContacts.length / POPULATION,
        rampRate: rampContacts.length / POPULATION,
        nearRate: near.length / POPULATION,
        controlledRate: controlled.length / POPULATION,
        stableRampRate: stableRamp.length / POPULATION,
        meanDistance: average(rampContacts.map((r) => r.metrics.distance!)),
        meanVerticalSpeed: average(rampContacts.map((r) => r.metrics.verticalSpeed!)),
        meanHorizontalSpeed: average(rampContacts.map((r) => r.metrics.horizontalSpeed!)),
        meanUpright: average(rampContacts.map((r) => r.metrics.upright!)),
        meanFacing: average(rampContacts.map((r) => r.metrics.facing!)),
        meanTurns: average(this.results.map((r) => r.metrics.turns)) ?? 0,
        nearVerticalRate: nearRate((metrics) => metrics.verticalSpeed! <= GENTLE_VERTICAL_SPEED),
        nearHorizontalRate: nearRate(
          (metrics) => metrics.horizontalSpeed! <= GENTLE_HORIZONTAL_SPEED,
        ),
        nearUprightRate: nearRate((metrics) => metrics.upright! >= 0.8),
        nearFacingRate: nearRate((metrics) => metrics.facing! >= 0.5),
        nearSpinRate: nearRate((metrics) => metrics.turns <= 1),
        meanPowerSpread: average(this.results.map((r) => r.metrics.powerSpread ?? 0)) ?? 0,
        meanNozzleTilt: average(this.results.map((r) => r.metrics.nozzleTilt ?? 0)) ?? 0,
        meanFlightUpright: average(this.results.map((r) => r.metrics.flightUpright ?? -1)) ?? -1,
        meanControlledDescent:
          average(this.results.map((r) => r.metrics.controlledDescent ?? 0)) ?? 0,
        meanApproachQuality: average(this.results.map((r) => r.metrics.approachQuality ?? 0)) ?? 0,
        meanBrakingScore: average(this.results.map((r) => r.brakingScore)) ?? 0,
        bestBraking: bestBraking.brakingScore > 0 ? bestBraking.metrics : undefined,
        best: best.metrics,
      },
    });
    if (this.history.length > 200) this.history.shift();
    this.genomes = breed(
      this.results,
      this.champion,
      this.brakingChampion,
      this.stagnantGenerations,
    );
    this.generation++;
    this.index = 0;
    this.results = [];
    if (this.champion) saveCheckpoint(this.checkpoint());
  }
  checkpoint(): Checkpoint {
    if (!this.champion) throw new Error("No champion has been trained yet");
    return {
      version: 1,
      scoreVersion: 17,
      shape: [...SHAPE],
      generation: this.generation - 1,
      champion: this.champion.slice(),
      bestFitness: Number.isFinite(this.bestFitness) ? this.bestFitness : -1e6,
      brakingChampion: this.brakingChampion?.slice(),
      bestBrakingScore: Number.isFinite(this.bestBrakingScore) ? this.bestBrakingScore : undefined,
      stagnantGenerations: this.stagnantGenerations,
      history: this.history.slice(),
    };
  }
  exportJSON() {
    const document = JSON.stringify(this.checkpoint(), null, 2);
    const url = URL.createObjectURL(new Blob([document], { type: "application/json" }));
    const a = window.document.createElement("a");
    a.href = url;
    a.download = "vectormind-champion.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  importJSON(raw: string) {
    const value = JSON.parse(raw) as Checkpoint;
    if (
      value.version !== 1 ||
      value.champion?.length !== this.genomes[0].length ||
      !value.champion.every(Number.isFinite)
    )
      throw Error("Invalid genome");
    if (value.scoreVersion === 17) {
      this.champion = value.champion.slice();
      this.bestFitness = value.bestFitness;
      this.brakingChampion = validGenome(value.brakingChampion)
        ? value.brakingChampion.slice()
        : null;
      this.bestBrakingScore = value.bestBrakingScore ?? -Infinity;
      this.stagnantGenerations = value.stagnantGenerations ?? 0;
      this.generation = value.generation + 1;
      this.history.splice(0, this.history.length, ...value.history.slice(-200));
      this.genomes = seedPopulation(this.champion, this.brakingChampion ?? undefined);
    } else {
      this.champion = null;
      this.bestFitness = -Infinity;
      this.brakingChampion = null;
      this.bestBrakingScore = -Infinity;
      this.stagnantGenerations = 0;
      this.generation = 1;
      this.history.length = 0;
      this.genomes = seedPopulation(
        previousGenome(value),
        validGenome(value.brakingChampion) ? value.brakingChampion : undefined,
      );
    }
    this.index = 0;
    this.results = [];
    this.scenarioIndex = 0;
    this.scenarioFitness = 0;
    this.scenarioBrakingScore = 0;
    this.nominalMetrics = null;
    this.replays.length = 0;
    this.displaying = false;
    this.displayGeneration = 0;
    if (this.running) this.startEpisode();
    if (this.champion) saveCheckpoint(this.checkpoint());
  }
}
