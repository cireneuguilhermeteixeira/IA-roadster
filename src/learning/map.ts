import type { FlightFrame, FlightReplay } from "./trainer";

type Point = { x: number; y: number; z: number };
type MapState = {
  replays: FlightReplay[];
  generation: number;
  nextGeneration: number;
  individual: number;
  seconds: number;
  displaying: boolean;
  trackAt: (distance: number) => { point: Point };
  trackLength: number;
  landing: Point;
};

const FRAME_RATE = 1 / (4 / 120);
const COLORS = {
  landed: "#67e8a5",
  ramp: "#57d5ff",
  ground: "#ffbd69",
  missed: "#f27780",
};

function color(replay: FlightReplay) {
  const metrics = replay.metrics;
  if (
    metrics.surface === "ramp" &&
    metrics.finalSurface === "ramp" &&
    (metrics.postContactUpright ?? -1) >= 0.8 &&
    (metrics.postContactMinUpright ?? -1) >= 0.6 &&
    (metrics.postContactFacing ?? -1) >= 0.5 &&
    (metrics.postContactHorizontalSpeed ?? Infinity) <= 4 &&
    (metrics.postContactAngularSpeed ?? Infinity) <= 0.75 &&
    (metrics.postContactRampFraction ?? 0) >= 0.8
  )
    return COLORS.landed;
  if (metrics.surface === "ramp") return COLORS.ramp;
  if (metrics.surface === "ground") return COLORS.ground;
  return COLORS.missed;
}

function drawCar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  fill: string,
  upright: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-angle);
  ctx.fillStyle = fill;
  ctx.strokeStyle = upright < 0 ? "#ff4d6d" : "#071522";
  ctx.lineWidth = upright < 0 ? 2.5 : 1.5;
  ctx.beginPath();
  ctx.roundRect(-7, -3.5, 14, 7, 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#e7f5ff";
  ctx.fillRect(3, -2, 2, 4);
  ctx.restore();
}

export function drawTrainingMap(canvas: HTMLCanvasElement, state: MapState) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#071421";
  ctx.fillRect(0, 0, w, h);
  const left = 58;
  const right = w - 24;
  const sideTop = 100;
  const sideBottom = Math.round(h * 0.68);
  const topTop = sideBottom + 55;
  const topBottom = h - 39;
  const xMin = -39;
  const xMax = 25;
  const sideX = (x: number) => left + ((x - xMin) / (xMax - xMin)) * (right - left);
  const sideY = (y: number) => sideBottom - ((y + 3) / 49) * (sideBottom - sideTop);
  const topZ = (z: number) => (topTop + topBottom) / 2 - (z / 18) * (topBottom - topTop);

  ctx.fillStyle = "#e9f7ff";
  ctx.font = "bold 23px system-ui";
  ctx.fillText(
    state.displaying
      ? `GERAÇÃO ${state.generation}  ·  ${state.replays.length} CARROS`
      : `GERAÇÃO ${state.nextGeneration}  ·  CALCULANDO VOOS`,
    28,
    38,
  );
  ctx.font = "14px system-ui";
  ctx.fillStyle = "#9ebed0";
  ctx.fillText(
    state.displaying
      ? `Reprodução sincronizada dos voos reais  ·  ${state.seconds.toFixed(1)} / 8.0 s`
      : `${state.individual} / 96 indivíduos simulados  ·  a animação conjunta começa ao fechar a geração`,
    28,
    65,
  );
  ctx.fillStyle = "#7b9ab1";
  ctx.fillText("VISTA LATERAL  ·  ALTURA E DISTÂNCIA", left, sideTop - 16);
  ctx.fillText("VISTA SUPERIOR  ·  DESVIO LATERAL", left, topTop - 18);

  ctx.strokeStyle = "#234258";
  ctx.lineWidth = 1;
  for (let x = -30; x <= 20; x += 10) {
    ctx.beginPath();
    ctx.moveTo(sideX(x), sideTop);
    ctx.lineTo(sideX(x), sideBottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sideX(x), topTop);
    ctx.lineTo(sideX(x), topBottom);
    ctx.stroke();
    ctx.fillStyle = "#7294aa";
    ctx.font = "11px system-ui";
    ctx.fillText(`${x} m`, sideX(x) - 12, sideBottom + 17);
  }
  for (let y = 0; y <= 40; y += 10) {
    ctx.beginPath();
    ctx.moveTo(left, sideY(y));
    ctx.lineTo(right, sideY(y));
    ctx.stroke();
    ctx.fillStyle = "#7294aa";
    ctx.fillText(`${y} m`, 17, sideY(y) + 4);
  }
  ctx.strokeStyle = "#ae8152";
  ctx.lineWidth = 13;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i <= 140; i++) {
    const p = state.trackAt((i / 140) * state.trackLength).point;
    if (i === 0) ctx.moveTo(sideX(p.x), sideY(p.y));
    else ctx.lineTo(sideX(p.x), sideY(p.y));
  }
  ctx.stroke();
  ctx.strokeStyle = "#f2c891";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#ad7950";
  ctx.fillRect(left, sideY(0), right - left, sideBottom - sideY(0));

  // Ramp footprint and intended landing point in the horizontal plane.
  ctx.fillStyle = "#7e603f";
  ctx.fillRect(sideX(xMin), topZ(4.5), sideX(xMax) - sideX(xMin), topZ(-4.5) - topZ(4.5));
  ctx.strokeStyle = "#e7b981";
  ctx.lineWidth = 2;
  ctx.strokeRect(sideX(xMin), topZ(4.5), sideX(xMax) - sideX(xMin), topZ(-4.5) - topZ(4.5));
  for (const target of [
    [sideX(state.landing.x), sideY(state.landing.y)],
    [sideX(state.landing.x), topZ(state.landing.z)],
  ]) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(target[0], target[1], 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(target[0] - 19, target[1]);
    ctx.lineTo(target[0] + 19, target[1]);
    ctx.moveTo(target[0], target[1] - 19);
    ctx.lineTo(target[0], target[1] + 19);
    ctx.stroke();
  }

  if (state.displaying) {
    let ramp = 0,
      ground = 0,
      stable = 0;
    for (const replay of state.replays) {
      const fill = color(replay);
      if (replay.metrics.surface === "ramp") ramp++;
      if (replay.metrics.surface === "ground") ground++;
      if (fill === COLORS.landed) stable++;
      const frames = replay.frames;
      const position = Math.min(frames.length - 1, Math.floor(state.seconds * FRAME_RATE));
      const car: FlightFrame = frames[position];
      if (!car) continue;
      const firstTail = Math.max(0, position - 42);
      ctx.beginPath();
      for (let i = firstTail; i <= position; i += 3) {
        const frame = frames[i];
        if (!frame) continue;
        if (i === firstTail) ctx.moveTo(sideX(frame.x), sideY(frame.y));
        else ctx.lineTo(sideX(frame.x), sideY(frame.y));
      }
      ctx.strokeStyle = fill + "55";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      drawCar(ctx, sideX(car.x), sideY(car.y), car.angle, fill, car.upright);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(sideX(car.x), topZ(car.z), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#bad6e6";
    ctx.font = "13px system-ui";
    ctx.fillText(
      `Contato: ${ramp} na rampa · ${ground} no solo · ${stable} estáveis no fim`,
      left,
      h - 13,
    );
  } else {
    ctx.fillStyle = "#62ccf4";
    ctx.fillRect(left, h - 18, (right - left) * (state.individual / 96), 5);
  }
  ctx.font = "12px system-ui";
  const legend = [
    [COLORS.landed, "estável"],
    [COLORS.ramp, "rampa"],
    [COLORS.ground, "solo"],
    [COLORS.missed, "sem contato"],
  ] as const;
  legend.forEach(([fill, label], i) => {
    const x = right - 340 + i * 85;
    ctx.fillStyle = fill;
    ctx.fillRect(x, 52, 9, 9);
    ctx.fillStyle = "#aac7d8";
    ctx.fillText(label, x + 13, 61);
  });
}
