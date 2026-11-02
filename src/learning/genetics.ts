import { randomGenome, SHAPE, WEIGHT_COUNT, type Genome } from "./network";

/** Impact, in-flight, and post-contact measurements from one physics episode. */
export type EpisodeMetrics = {
  /** Surface and planar target error at the first valid contact. */
  surface: "ground" | "ramp" | null;
  distance: number | null;
  /** Car-center height and translational/rotational speeds at first contact. */
  contactHeight?: number | null;
  verticalSpeed: number | null;
  horizontalSpeed: number | null;
  impactAngularSpeed?: number | null;
  /** Up-axis and heading alignment at impact, each roughly in [-1, 1]. */
  upright: number | null;
  facing: number | null;
  /** Integrated equivalent full rotations and whether any low contact occurred. */
  turns: number;
  contacted: boolean;
  /** Surface, target error, speeds, and orientation after post-contact observation. */
  finalSurface?: "ground" | "ramp" | null;
  finalDistance?: number;
  finalVerticalSpeed?: number;
  finalHorizontalSpeed?: number;
  finalUpright?: number;
  finalFacing?: number;
  finalAngularSpeed?: number;
  /** Pre-impact motor usage and average flight-quality diagnostics. */
  motorPower?: number[];
  powerSpread?: number;
  nozzleTilt?: number;
  flightUpright?: number;
  controlledDescent?: number;
  approachQuality?: number;
  nearGroundHoverSeconds?: number;
  /** Averages and minimums over the interval following first contact. */
  postContactUpright?: number;
  postContactMinUpright?: number;
  postContactFacing?: number;
  postContactHorizontalSpeed?: number;
  postContactAngularSpeed?: number;
  postContactMotorPower?: number;
  postContactRampFraction?: number;
};
/** Rates and averages for the nominal flights of one complete generation. */
export type GenerationDiagnostics = {
  /** Population shares for first contact and increasingly strict landing outcomes. */
  groundRate: number;
  rampRate: number;
  nearRate: number;
  controlledRate: number;
  stableRampRate?: number;
  /** Mean impact metrics restricted to nominal flights that touched the ramp. */
  meanDistance: number | null;
  meanVerticalSpeed: number | null;
  meanHorizontalSpeed: number | null;
  meanUpright: number | null;
  meanFacing: number | null;
  meanTurns: number;
  /** Conditional shares among nominal ramp contacts within the target radius. */
  nearVerticalRate: number | null;
  nearHorizontalRate: number | null;
  nearUprightRate: number | null;
  nearFacingRate: number | null;
  nearSpinRate: number | null;
  /** Population averages for motor behavior, orientation, and approach. */
  meanPowerSpread?: number;
  meanNozzleTilt?: number;
  meanFlightUpright?: number;
  meanControlledDescent?: number;
  meanApproachQuality?: number;
  meanBrakingScore?: number;
  /** Strongest braking specialist and best overall individual of this generation. */
  bestBraking?: EpisodeMetrics;
  best: EpisodeMetrics;
};
/** A genome with its two-flight mean scores and nominal-flight metrics. */
export type Individual = {
  genome: Genome;
  fitness: number;
  success: boolean;
  metrics: EpisodeMetrics;
  brakingScore: number;
};
/** Compact historical row consumed by the HUD charts. */
export type GenerationRecord = {
  generation: number;
  best: number;
  mean: number;
  successRate: number;
  bestEver: number;
  diagnostics?: GenerationDiagnostics;
};
/** Persistent champion archive; the full population is rebuilt on reload. */
export type Checkpoint = {
  /** File schema and scoring-rule version for safe resume/migration. */
  version: 1;
  scoreVersion?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18;
  shape: number[];
  /** Last fully completed generation, archived champion DNA, and its record score. */
  generation: number;
  champion: Genome;
  bestFitness: number;
  /** Optional specialist archive kept separately from the overall champion. */
  brakingChampion?: Genome;
  bestBrakingScore?: number;
  stagnantGenerations?: number;
  /** At most 200 compact rows; no per-flight frames or full population. */
  history: GenerationRecord[];
};
/** Browser-local save slot and fixed number of neural candidates per generation. */
export const STORAGE_KEY = "vectormind-neuroevolution-v1";
export const POPULATION = 96;
/** Unmutated overall and braking specialists retained during breeding. */
const ELITES = 8;
const BRAKING_ELITES = 4;
/** Bernoulli draw used to choose mutation branches and parents. */
const chance = (probability: number) => Math.random() < probability;
/** Positive at every finite impact speed, without a cutoff at 3 m/s. */
export function landingSpeedQuality(verticalSpeed: number, horizontalSpeed: number): number {
  const impactSpeed = Math.hypot(verticalSpeed, horizontalSpeed);
  return Number.isFinite(impactSpeed) ? 1 / (1 + impactSpeed / 6) : 0;
}
/** Rank slow ramp impacts separately from the full landing objective. */
export function brakingScore(metrics: EpisodeMetrics): number {
  if (metrics.surface !== "ramp" || metrics.distance === null) return 0;
  const vertical = metrics.verticalSpeed ?? Infinity;
  const horizontal = metrics.horizontalSpeed ?? Infinity;
  // A slower ramp touch must beat a fast hit at the exact center. Horizontal
  // error and travel still matter, but are secondary in this specialist pool.
  return Math.exp(-metrics.distance / 20) / (1 + vertical / 6) / (1 + horizontal / 12);
}
/** Standard normal noise for small, symmetric weight changes. */
function gaussian(): number {
  return (
    Math.sqrt(-2 * Math.log(Math.max(1e-12, Math.random()))) * Math.cos(2 * Math.PI * Math.random())
  );
}
/** Flat-genome offset and stride of the final layer's output neurons. */
const OUTPUT_START = SHAPE.slice(1, -1).reduce(
  (offset, width, layer) => offset + width * (SHAPE[layer] + 1),
  0,
);
const OUTPUT_STRIDE = SHAPE[SHAPE.length - 2] + 1;
/** Copy a parent, perturb a subset of weights, and occasionally shift shared lift. */
function mutate(source: Genome, sigma: number, mutationRate: number): Genome {
  const child = source.map((weight) =>
    Math.max(-4, Math.min(4, weight + (chance(mutationRate) ? gaussian() * sigma : 0))),
  );
  if (chance(0.18)) {
    // Move one shared output weight in all four motors. This can change total
    // lift, including as a function of a hidden sensor, without introducing
    // a large torque from four unrelated power changes.
    const input = Math.floor(Math.random() * OUTPUT_STRIDE);
    const shift = gaussian() * sigma * 1.5;
    for (let motor = 0; motor < 4; motor++) {
      const index = OUTPUT_START + motor * OUTPUT_STRIDE + input;
      child[index] = Math.max(-4, Math.min(4, child[index] + shift));
    }
  }
  return child;
}
/**
 * Preserve high performers and fill the population with local and broad variants.
 * `population` contains scored DNAs from the current generation; `champion` and
 * `brakingChampion` are historical archives; `stagnantGenerations` widens the
 * exploratory mutation branch after repeated generations without a record.
 */
export function breed(
  population: Individual[],
  champion: Genome | null,
  brakingChampion: Genome | null = null,
  stagnantGenerations = 0,
): Genome[] {
  const exploring = stagnantGenerations >= 15;
  const ranked = [...population].sort((a, b) => b.fitness - a.fitness);
  const pool = ranked.slice(0, 12);
  const children = ranked.slice(0, ELITES).map((x) => x.genome.slice());
  if (champion) children[0] = champion.slice();
  if (brakingChampion) children.push(brakingChampion.slice());
  // Keep useful nominal landing behavior even when a specialist ranks lower overall.
  const stableLandings = ranked.filter(
    ({ metrics }) =>
      metrics.surface === "ramp" &&
      metrics.finalSurface === "ramp" &&
      (metrics.finalDistance ?? Infinity) <= 5 &&
      (metrics.postContactUpright ?? -1) >= 0.8 &&
      (metrics.postContactHorizontalSpeed ?? Infinity) <= 4 &&
      (metrics.postContactRampFraction ?? 0) >= 0.8,
  );
  for (const landing of stableLandings.slice(0, 4)) {
    if (!children.some((child) => child.every((weight, index) => weight === landing.genome[index])))
      children.push(landing.genome.slice());
  }
  const specialists = ranked
    .filter((individual) => individual.brakingScore > 0)
    .sort((a, b) => b.brakingScore - a.brakingScore)
    .slice(0, 12);
  let retainedSpecialists = 0;
  for (const specialist of specialists) {
    if (retainedSpecialists >= BRAKING_ELITES) break;
    if (ranked.slice(0, ELITES).includes(specialist)) continue;
    children.push(specialist.genome.slice());
    retainedSpecialists++;
  }
  // The probabilities apply to remaining slots after elites have been copied.
  while (children.length < POPULATION) {
    const roll = Math.random();
    if (roll < 0.05) {
      children.push(randomGenome());
      continue;
    }
    if (roll < 0.42 && champion) {
      children.push(mutate(champion, 0.025, 0.008));
      continue;
    }
    if (roll < 0.7) {
      const source = pool[Math.floor(Math.random() ** 2 * pool.length)];
      children.push(mutate(source.genome, 0.07, 0.015));
      continue;
    }
    if (roll < 0.86) {
      const source =
        stableLandings.length && chance(0.65)
          ? stableLandings[Math.floor(Math.random() * Math.min(4, stableLandings.length))].genome
          : (brakingChampion ?? specialists[0]?.genome ?? ranked[0].genome);
      children.push(mutate(source, 0.09, 0.015));
      continue;
    }
    const source = pool[Math.floor(Math.random() * pool.length)].genome;
    children.push(mutate(source, exploring ? 0.3 : 0.17, exploring ? 0.04 : 0.025));
  }
  return children;
}
/** Read a compatible localStorage record, returning null on absent or invalid data. */
export function loadCheckpoint(): Checkpoint | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const item = JSON.parse(raw) as Checkpoint;
    return item.version === 1 &&
      item.champion?.length === WEIGHT_COUNT &&
      Number.isFinite(item.bestFitness)
      ? item
      : null;
  } catch {
    return null;
  }
}
/** Persist one checkpoint; report storage failures without stopping training. */
export function saveCheckpoint(record: Checkpoint) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}
