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


<img width="364" height="335" alt="image" src="https://github.com/user-attachments/assets/d1f3c4b5-132a-4e8c-ad3f-3b4fa5a3d0fc" />

<img width="1365" height="607" alt="image" src="https://github.com/user-attachments/assets/db8bdea4-62d7-493d-92d9-dd20ff07a05a" />

"2002 Subaru Impreza WRX STi Extreme" (https://skfb.ly/pBTED) by SIU Car Garage is licensed under Creative Commons Attribution-NonCommercial (http://creativecommons.org/licenses/by-nc/4.0/).


"Jetpack propulsor" (https://skfb.ly/pu98M) by astronix is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).
