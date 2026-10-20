// Handwritten feed-forward MLP. No ML framework or external dependency.
export const SHAPE = [18, 24, 16, 12] as const;
export const WEIGHT_COUNT = SHAPE.slice(1).reduce((sum, n, index) => sum + n * (SHAPE[index] + 1), 0);
export type Trace = { layers: number[][]; outputs: number[] };
export type Genome = number[];

export function randomGenome(random: () => number = Math.random): Genome {
  return Array.from({ length: WEIGHT_COUNT }, () => (random() * 2 - 1) * 0.48);
}
export function forward(genome: Genome, sensors: number[]): Trace {
  if (genome.length !== WEIGHT_COUNT || sensors.length !== SHAPE[0])
    throw new Error("Neural network dimensions do not match the saved checkpoint.");
  const layers: number[][] = [sensors.map((v) => Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0)];
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
export function decode(outputs: number[]) {
  return Array.from({length:4}, (_,i) => ({
    power: Math.max(0, Math.min(1, (outputs[i] + 1) / 2)),
    tiltX: outputs[4+i] * 0.65,
    tiltZ: outputs[8+i] * 0.65,
  }));
}
