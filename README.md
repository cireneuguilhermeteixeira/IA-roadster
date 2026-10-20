# VectorMind

Three.js + Vite + TypeScript + Rapier WASM.

## Development

```bash
npm install
npm run typecheck
npm run dev
```

## Simulation

Rapier is the single authority for gravity, rigid-body movement, torque, inertia and collision. The Subaru is always a **dynamic** rigid body. The ramp is represented by the same triangular surface as the visible track. A magnetic guide acts perpendicular to the road to maintain contact; a separate motor drives the car along the road at about 18 m/s. The guide stops at the upper exit, where the thrusters become available.

Four independent jets apply world-space forces at axle points, creating torque through `RigidBody.addForceAtPoint`. Their power and nozzle angles change gradually; each jet has a maximum force of 6000 N. Near the exit, the track motor brakes the car. In automatic mode, the nozzles turn toward the force needed to cancel horizontal speed and descend onto the landing marker. The uploaded jetpack GLB appears when the car leaves the loop. Mass and moments of inertia are prototype estimates.

The chassis uses one rounded contact collider. The visible tires do not yet have moving suspension, independent wheel joints or tire-slip modelling. The guide is intentionally assisted because an inverted loop otherwise requires mechanically modeled adhesion. Motor, guide and reactor forces are cleared and recalculated on every physics step; after release, gravity and the reactors are the only active forces. Reactor force stops after ground contact.

The PID controller remains custom: physics engines calculate the response to forces, not the vehicle's flight objectives. The fixed-step simulation runs in real time when the renderer can keep up. No manual position or quaternion integration remains.

## Controls

W/S pitch, A/D roll, Q/E yaw; arrows vector thrust; T toggles autopilot (on by default); R reset; Enter launch. The power slider is a physical limit for each reactor, in manual and automatic modes: 10% allows at most 600 N from each 6000 N reactor, and 0% instantly stops all reactor force and attitude control. The default is 100% so the autopilot has enough thrust to brake and land; it still uses only the power it needs.

Open the app with `?reactors=off` to test a ballistic flight with all four reactor forces held at zero. The throttle is disabled in this mode. The car still accelerates along the ramp and then falls under gravity.

## Assets

The Subaru and four jetpack visuals are loaded from GLB files under `public/models`. See the upstream model's distribution license before reuse.

## Genetic flight controller (no ML libraries)

Inspired by [JVictorDias/Dinossauro-Google](https://github.com/JVictorDias/Dinossauro-Google), which evolves a multilayer perceptron by random mutation, with population fitness selection. This independent TypeScript implementation uses a handwritten dense MLP (18→24→16→12, 1,060 trainable parameters), tanh activations, a population of 32, elite preservation (4), top-parent selection, uniform crossover, Gaussian mutation and occasional random immigrants.

The 18 sensors consist of target offset (3), local velocity (3), local up (3), desired facing direction (3), local angular velocity (3), relative height (1), elapsed flight time (1) and bias (1). All inputs are normalized and clamped. Twelve outputs directly command four independent nozzle powers and four tilt-X + four tilt-Z angles.

Click **INICIAR TREINO**: an isolated Rapier world simulates the ramp once to capture a release state; then it evaluates each genome in fixed-length episodes with randomized release state. Episodes run in small chunks while the scene remains interactive. Selection rewards upright, forward-facing, gentle, low-spin landings near the target, penalizes long episodes and non-landing. The visual neural graph highlights signed activations and fitness history tracks generation best and mean. The best genome and history are saved in browser localStorage after every generation and can be exported/imported as JSON. **PILOTO NEURAL** applies the champion to the real-time vehicle (turn the standard autopilot off).

Limitations: a single training simulation runs sequentially alongside the renderer, so learning may take many generations and significant wall-clock time. No guarantee of competent behavior without training; no historical pretrained champion is provided. The current reward uses the existing landing detector; complex terrain, accurate collision-speed sensing, rolling/sliding and map randomization require further environment instrumentation before generalization can be claimed. The manual controller and Rapier world remain unchanged for baseline comparison.
