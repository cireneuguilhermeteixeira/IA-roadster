// Handwritten feed-forward MLP; the array lists input, hidden, and output widths.
export const SHAPE = [18, 24, 16, 12] as const;
/** Number of flat-genome parameters, including one bias per non-input neuron. */
export const WEIGHT_COUNT = SHAPE.slice(1).reduce(
  (sum, n, index) => sum + n * (SHAPE[index] + 1),
  0,
);
/** Values of every layer, retained for the neural-activation canvas. */
export type Trace = { layers: number[][]; outputs: number[] };
/** Flat list of all trainable weights and biases; fixed during one flight. */
export type Genome = number[];

/** The old last sensor was always 1. Move its weights into the trainable
 * neuron biases, leaving the new contact sensor neutral until it evolves. */
export function migrateLegacyBiasSensor(genome: Genome): Genome {
  if (genome.length !== WEIGHT_COUNT) throw new Error("Invalid genome length");
  const migrated = genome.slice();
  const stride = SHAPE[0] + 1;
  for (let neuron = 0; neuron < SHAPE[1]; neuron++) {
    const bias = neuron * stride;
    const oldConstantInput = bias + SHAPE[0];
    migrated[bias] += migrated[oldConstantInput];
    migrated[oldConstantInput] = 0;
  }
  return migrated;
}

/** Initialize a new candidate with small weights around zero. */
export function randomGenome(random: () => number = Math.random): Genome {
  return Array.from({ length: WEIGHT_COUNT }, () => (random() * 2 - 1) * 0.48);
}
/** Recompute all neuron activations from the current 18-sensor observation. */
export function forward(genome: Genome, sensors: number[]): Trace {
  if (genome.length !== WEIGHT_COUNT || sensors.length !== SHAPE[0])
    throw new Error("Neural network dimensions do not match the saved checkpoint.");
  const layers: number[][] = [
    sensors.map((v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0)),
  ];
  // Offset walks through the flat genome in bias-then-input-weight order.
  let offset = 0;
  for (let layer = 1; layer < SHAPE.length; layer++) {
    const previous = layers[layer - 1];
    const next: number[] = [];
    for (let neuron = 0; neuron < SHAPE[layer]; neuron++) {
      let weighted = genome[offset++]; // trainable bias
      for (let i = 0; i < previous.length; i++) weighted += previous[i] * genome[offset++];
      // Hidden tanh avoids unbounded activations. Sigmoid/tanh outputs have actuator bounds.
      next.push(layer === SHAPE.length - 1 ? Math.tanh(weighted) : Math.tanh(weighted));
    }
    layers.push(next);
  }
  return { layers, outputs: layers[layers.length - 1] };
}
/** Map 12 bounded outputs to power and two nozzle angles for each of four jets. */
export function decode(outputs: number[]) {
  return Array.from({ length: 4 }, (_, i) => ({
    power: Math.max(0, Math.min(1, (outputs[i] + 1) / 2)),
    tiltX: outputs[4 + i] * 0.65,
    tiltZ: outputs[8 + i] * 0.65,
  }));
}
