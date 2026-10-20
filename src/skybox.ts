import * as THREE from "three";

// One seamless equirectangular image covering the entire environment (2:1).
export function setupSkybox(scene: THREE.Scene): void {
  const texture = new THREE.TextureLoader().load(
    "/textures/sunset-panorama.svg",
    undefined,
    undefined,
    (error) => console.warn("Sky panorama unavailable:", error),
  );
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  scene.background = texture;
  scene.backgroundIntensity = 0.95;
}
