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

## Caatinga scene

Procedural scenery inspired by interior Ceará, including carnaúba palms, mandacaru cacti, dry trees, sandy soil and rocks. The ramp radius, approach and inverted exit have been enlarged. The vegetation is decorative and has no colliders.
