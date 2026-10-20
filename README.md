# VectorMind

Three.js + Vite + TypeScript + Rapier WASM.

## Development
```bash
npm install
npm run typecheck
npm run dev
```

## Simulation
Rapier is the single authority for gravity, rigid-body movement, torque, inertia and collision. The Subaru is always a **dynamic** rigid body. The ramp is represented by the same triangular surface as the visible track. The car moves via forces, including a **magnetic guide and track motor** that hold it on the inverted half-loop until the end of the track; these are explicit game actuators rather than teleportation. The launch releases those forces, with no switch to kinematic motion.

Four independent jets apply actual world-space forces at axle points, creating real torque through `RigidBody.addForceAtPoint`. The uploaded jetpack GLB appears when the car leaves the loop. Mass and moments of inertia are prototype estimates.

The tires currently use fixed spherical colliders; they **do not** yet have moving suspension, independent wheel joints, tire-slip modelling, or a Rapier vehicle controller. The ramp contact is dynamic, but the guide motor is intentionally assisted because an inverted loop otherwise requires mechanically modeled adhesion.

The PID controller remains custom: physics engines calculate the response to forces, not the vehicle's flight objectives. No manual position/velocity/quaternion integration remains. The 0.55x simulation playback is for usability.

## Controls
W/S pitch, A/D roll, Q/E yaw; arrows vector thrust; Shift full thrust; T autopilot; R reset; Enter launch.

## Assets
The Subaru and four jetpack visuals are loaded from GLB files under `public/models`. See the upstream model's distribution license before reuse.
