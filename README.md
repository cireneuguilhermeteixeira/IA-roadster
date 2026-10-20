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

The app loads `public/models/subaru-2002.glb` via `GLTFLoader` and uses the procedural fallback when the asset is unavailable. **The linked Sketchfab model is not bundled**: access/license could not be verified. Read [model instructions](public/models/README.md).

### Controls

W/S pitch, A/D roll, Q/E yaw; arrow keys thrust vector; Shift full power; T auto stabilize; R reset; Enter launch.

## Current physics limits

The existing simulator implements simplified numerical flight dynamics rather than Rapier rigid-body simulation. The car follows a predefined half-loop path and then enters free fall. Vehicle geometry is purely visual; collision and auto-stabilization remain the original prototype behavior.

## Credits

Subaru model: attribution and license details must be added after obtaining the model from its creator. No third-party 3D mesh is included in this repository.
