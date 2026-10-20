# VectorMind — TypeScript + Vite + Three.js

Migrated from the original IA-roadster JavaScript prototype, preserving the half-loop ramp, free-fall, four independently vectored thrusters, controls and automatic attitude stabilization.

## Development

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

## Subaru body

The app loads `public/models/2002_subaru_impreza_wrx_sti_extreme.glb` via `GLTFLoader` and uses the procedural fallback when the asset is unavailable. The Subaru GLB is included in the repository and loaded automatically. Its original creator/license must still be credited and redistribution rights verified.

### Controls

W/S pitch, A/D roll, Q/E yaw; arrow keys thrust vector; Shift full power; T auto stabilize; R reset; Enter launch.

## Current physics limits

The existing simulator implements simplified numerical flight dynamics rather than Rapier rigid-body simulation. The car follows a predefined half-loop path and then enters free fall. Vehicle geometry is purely visual; collision and auto-stabilization remain the original prototype behavior.

## Credits

Subaru model: attribution and license details must be added after obtaining the model from its creator. No third-party 3D mesh is included in this repository.

## Environment

Small optimized 3D environment with fewer, larger foreground vegetation objects and a seamless 360° equirectangular sunset panorama (`public/textures/sunset-panorama.svg`) for distant mountains and sky. No geometry is used for distant mountains. The panorama is an original lightweight SVG image and can be replaced with an HDRI or PNG of 2:1 aspect ratio. The flight simulation and ramp dimensions are unchanged.

## Rigid-body simulation

The free-flight integration uses Rapier 3D (WASM) with a 1450 kg chassis, calibrated principal inertias (690/3050/2800 kg·m²), 11 kN peak thrust per nozzle, finite actuator response and per-corner `addForceAtPoint`. The kinematic scripted half-loop is retained; the car is switched to a dynamic rigid body on launch. The supplied `jetpack_propulsor.glb` replaces procedural thruster meshes, with fallback on load failure. These are prototype calibration parameters rather than validated real-world Subaru values. Flight/landing and control behavior require in-browser evaluation.
